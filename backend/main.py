"""
main.py — Relay Protection AI Agent
FastAPI + OpenRouter (chat) + OpenAI (embeddings) + ChromaDB RAG
"""

import os, math
from typing import List, Optional, AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, UploadFile, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv
from openai import OpenAI, AsyncOpenAI

load_dotenv()

# ─────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────
OPENAI_API_KEY  = os.getenv("OPENAI_API_KEY", "")
MODEL           = os.getenv("MODEL", "openai/gpt-4o-mini")
BASE_URL        = os.getenv("OPENAI_BASE_URL", "https://openrouter.ai/api/v1")
SYSTEM_PROMPT_F = os.path.join(os.path.dirname(__file__), "system_prompt.txt")
DOCS_DIR        = os.path.join(os.path.dirname(__file__), "docs")
MAX_UPLOAD_MB   = 50

os.makedirs(DOCS_DIR, exist_ok=True)

if not OPENAI_API_KEY:
    print("WARNING: OPENAI_API_KEY is not set!")
else:
    print(f"[OK] API Key loaded — {len(OPENAI_API_KEY)} chars")
    print(f"[OK] Chat model : {MODEL}")
    print(f"[OK] Chat URL   : {BASE_URL}")

# ─────────────────────────────────────────────────────────────
# CLIENTS — chat goes to OpenRouter, embeddings go to real OpenAI
# ─────────────────────────────────────────────────────────────
client = OpenAI(api_key=OPENAI_API_KEY, base_url=BASE_URL)
async_client = AsyncOpenAI(api_key=OPENAI_API_KEY, base_url=BASE_URL)

# ─────────────────────────────────────────────────────────────
# SYSTEM PROMPT
# ─────────────────────────────────────────────────────────────
def load_system_prompt() -> str:
    if os.path.exists(SYSTEM_PROMPT_F):
        with open(SYSTEM_PROMPT_F, "r", encoding="utf-8") as f:
            return f.read().strip()
    return "You are an expert relay protection engineer AI assistant."

SYSTEM_PROMPT = load_system_prompt()
print(f"[OK] System prompt loaded ({len(SYSTEM_PROMPT)} chars)")

# ─────────────────────────────────────────────────────────────
# RAG
# ─────────────────────────────────────────────────────────────
rag_ready         = False
_retrieve_context = None
_rag_error        = ""        # store last RAG error for /rag/debug endpoint

def _try_load_rag():
    global rag_ready, _retrieve_context, _rag_error
    try:
        from rag import retrieve_context, get_collection_stats
        stats = get_collection_stats()
        if stats.get("ready") and stats.get("chunk_count", 0) > 0:
            _retrieve_context = retrieve_context
            rag_ready = True
            print(f"[OK] RAG ready — {stats['chunk_count']} chunks from {list(stats.get('sources', {}).keys())}")
        else:
            _rag_error = stats.get("error", "vectordb empty or not found")
            print(f"[INFO] RAG not ready: {_rag_error}")
    except Exception as e:
        _rag_error = str(e)
        print(f"[INFO] RAG load failed: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    _try_load_rag()
    yield

# ─────────────────────────────────────────────────────────────
# APP
# ─────────────────────────────────────────────────────────────
app = FastAPI(
    title="Relay Protection AI Agent",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────────────────────
# MODELS
# ─────────────────────────────────────────────────────────────
class Message(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[Message]
    stream: bool = True
    use_rag: bool = True

class FaultCalcRequest(BaseModel):
    fault_type: str
    voltage_kv: float
    z1_mag: float
    z1_ang: float = 80.0
    z2_mag: Optional[float] = None
    z2_ang: float = 80.0
    z0_mag: Optional[float] = None
    z0_ang: float = 70.0
    zf_mag: float = 0.0
    zf_ang: float = 0.0

# ─────────────────────────────────────────────────────────────
# FAULT CALCULATION ENGINE
# ─────────────────────────────────────────────────────────────
def to_complex(mag: float, ang_deg: float) -> complex:
    return complex(
        mag * math.cos(math.radians(ang_deg)),
        mag * math.sin(math.radians(ang_deg))
    )

def fmt_z(z: complex) -> str:
    return f"{abs(z):.4f}{chr(8736)}{math.degrees(math.phase(z)):.2f} Ohm"

def run_fault_calc(req: FaultCalcRequest) -> dict:
    V_LN = (req.voltage_kv * 1000) / math.sqrt(3)
    Z1   = to_complex(req.z1_mag, req.z1_ang)
    Z2   = to_complex(req.z2_mag if req.z2_mag is not None else req.z1_mag, req.z2_ang)
    Z0   = to_complex(req.z0_mag if req.z0_mag is not None else 3 * req.z1_mag, req.z0_ang)
    Zf   = to_complex(req.zf_mag, req.zf_ang)
    ft   = req.fault_type.upper()
    Ia1  = Ia2 = Ia0 = Ia = complex(0)
    steps = []

    steps.append({
        "step": 1, "title": "System Data",
        "content": (
            f"System Voltage    = {req.voltage_kv} kV (L-L)\n"
            f"V_LN (pre-fault)  = {V_LN/1000:.4f} kV = {V_LN:.2f} V\n"
            f"Z1 = {fmt_z(Z1)}\nZ2 = {fmt_z(Z2)}\nZ0 = {fmt_z(Z0)}\nZf = {fmt_z(Zf)}"
        )
    })

    if ft == "SLG":
        steps.append({"step": 2, "title": "Formula — SLG",
            "content": "Ia = 3 x Vf / (Z1 + Z2 + Z0 + 3*Zf)\nSequence networks in SERIES."})
        Zt  = Z1 + Z2 + Z0 + 3 * Zf
        Ia1 = complex(1, 0) / Zt
        Ia2 = Ia1; Ia0 = Ia1; Ia = 3 * Ia0
        steps.append({"step": 3, "title": "Calculation",
            "content": f"Z_total = {fmt_z(Zt)}\nIa1=Ia2=Ia0 = {abs(Ia1):.5f} pu\nIa = 3*Ia0 = {abs(Ia):.5f} pu"})

    elif ft == "LL":
        steps.append({"step": 2, "title": "Formula — LL",
            "content": "Ia1 = Vf / (Z1 + Z2 + Zf)\nIb = -Ic"})
        Zt  = Z1 + Z2 + Zf
        Ia1 = complex(1, 0) / Zt
        Ia2 = -Ia1; Ia0 = complex(0)
        a   = complex(-0.5,  math.sqrt(3)/2)
        a2  = complex(-0.5, -math.sqrt(3)/2)
        Ib  = Ia0 + a2*Ia1 + a*Ia2; Ia = Ib
        steps.append({"step": 3, "title": "Calculation",
            "content": f"Z_total = {fmt_z(Zt)}\nIa1 = {abs(Ia1):.5f} pu\nIb = {abs(Ib):.5f} pu"})

    elif ft == "DLG":
        steps.append({"step": 2, "title": "Formula — DLG",
            "content": "Z_par = Z2 || (Z0+3Zf)\nIa1 = Vf / (Z1 + Z_par)"})
        Z0f = Z0 + 3*Zf; Zp = (Z2 * Z0f) / (Z2 + Z0f)
        Ia1 = complex(1, 0) / (Z1 + Zp)
        Ia2 = -Ia1 * Z0f / (Z2 + Z0f)
        Ia0 = -Ia1 * Z2  / (Z2 + Z0f)
        a   = complex(-0.5,  math.sqrt(3)/2)
        a2  = complex(-0.5, -math.sqrt(3)/2)
        Ib  = Ia0 + a2*Ia1 + a*Ia2
        Ic  = Ia0 + a*Ia1  + a2*Ia2; Ia = Ib + Ic
        steps.append({"step": 3, "title": "Calculation",
            "content": f"Z_par={fmt_z(Zp)}\nIa1={abs(Ia1):.5f} pu\nIa2={abs(Ia2):.5f} pu\nIa0={abs(Ia0):.5f} pu\nIg={abs(Ia):.5f} pu"})

    elif ft == "3PH":
        steps.append({"step": 2, "title": "Formula — 3PH",
            "content": "Ia = Vf / (Z1 + Zf)\nPositive-sequence only."})
        Zt = Z1 + Zf; Ia1 = complex(1, 0) / Zt; Ia = Ia1
        steps.append({"step": 3, "title": "Calculation",
            "content": f"Z_total = {fmt_z(Zt)}\nIa = {abs(Ia):.5f} pu"})
    else:
        raise HTTPException(400, f"Unknown fault type '{ft}'. Use: SLG, LL, DLG, 3PH")

    Z1_mag = abs(Z1)
    Ia_A   = abs(Ia) * V_LN / Z1_mag if Z1_mag > 0 else 0

    steps.append({"step": 4, "title": "Final Answer",
        "content": (
            f"Fault Current (pu) = {abs(Ia):.5f} pu\n"
            f"Fault Current (A)  = {Ia_A:.2f} A\n\n"
            f"Sequence Currents:\n"
            f"  Ia1 = {abs(Ia1):.5f} pu\n"
            f"  Ia2 = {abs(Ia2):.5f} pu\n"
            f"  Ia0 = {abs(Ia0):.5f} pu"
        )})

    return {
        "fault_type": ft, "voltage_kv": req.voltage_kv,
        "ia_pu": round(abs(Ia), 5), "ia_angle_deg": round(math.degrees(math.phase(Ia)), 2),
        "ia_primary_A": round(Ia_A, 2),
        "ia1_pu": f"{abs(Ia1):.5f}", "ia2_pu": f"{abs(Ia2):.5f}", "ia0_pu": f"{abs(Ia0):.5f}",
        "impedances": {"Z1": fmt_z(Z1), "Z2": fmt_z(Z2), "Z0": fmt_z(Z0), "Zf": fmt_z(Zf)},
        "steps": steps,
    }

# ─────────────────────────────────────────────────────────────
# PROMPT BUILDER — RAG context injection
# ─────────────────────────────────────────────────────────────
def build_messages(user_messages: List[Message], rag_ctx: str = "") -> list:
    sys_content = SYSTEM_PROMPT

    if rag_ctx:
        # Strong, unambiguous instruction that the LLM cannot ignore
        sys_content += (
            "\n\n"
            "##########################################################\n"
            "# RETRIEVED DOCUMENT CONTEXT — READ THIS FIRST          #\n"
            "##########################################################\n"
            "The chunks below come directly from the user's uploaded PDF documents.\n"
            "These are your PRIMARY source of truth for this query.\n\n"
            "MANDATORY RULES:\n"
            "1. Read every chunk below carefully before forming your answer.\n"
            "2. Your answer MUST be based on what is written in these chunks.\n"
            "3. Always cite which document and page your answer comes from.\n"
            "4. If the chunks contain the answer — use ONLY the chunks. Do not add from memory.\n"
            "5. If the chunks partially answer — use them first, then clearly label any additions\n"
            "   as: '[From general knowledge, not in uploaded documents]'\n"
            "6. If the chunks do NOT contain the answer — say:\n"
            "   'This was not found in the uploaded documents.' then answer from general knowledge.\n"
            "7. NEVER pretend the chunks do not exist. NEVER answer purely from memory\n"
            "   when document chunks have been provided.\n\n"
            "##########################################################\n"
            "# START OF RETRIEVED CHUNKS                             #\n"
            "##########################################################\n\n"
            + rag_ctx
            + "\n\n"
            "##########################################################\n"
            "# END OF RETRIEVED CHUNKS                               #\n"
            "# Now answer the user's question using the above content #\n"
            "##########################################################\n"
        )
    else:
        # No RAG context — be transparent about it
        sys_content += (
            "\n\n"
            "##########################################################\n"
            "# NO DOCUMENT CONTEXT AVAILABLE                         #\n"
            "##########################################################\n"
            "No document chunks were retrieved for this query.\n"
            "This means either:\n"
            "  a) No documents have been uploaded yet, OR\n"
            "  b) The uploaded documents do not contain relevant content for this query.\n\n"
            "Answer from your general relay protection engineering knowledge.\n"
            "If the user expects document-specific answers, tell them:\n"
            "  'I did not find this in your uploaded documents. Please check that the\n"
            "   correct PDF has been uploaded and RAG is enabled (toggle in chat).'\n"
            "##########################################################\n"
        )

    msgs = [{"role": "system", "content": sys_content}]
    for m in user_messages:
        msgs.append({"role": m.role, "content": m.content})
    return msgs

# ─────────────────────────────────────────────────────────────
# ENDPOINTS
# ─────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    openai_ok = False
    error_msg = ""
    try:
        client.models.list()
        openai_ok = True
    except Exception as e:
        error_msg = str(e)

    docs = []
    if os.path.exists(DOCS_DIR):
        docs = [f for f in os.listdir(DOCS_DIR) if f.endswith(".pdf")]

    return {
        "status":     "ok" if openai_ok else "degraded",
        "openai":     "connected" if openai_ok else f"error: {error_msg}",
        "model":      MODEL,
        "base_url":   BASE_URL,
        "rag_ready":  rag_ready,
        "rag_error":  _rag_error if not rag_ready else "",
        "docs_count": len(docs),
        "docs":       docs,
    }


@app.get("/rag/debug")
async def rag_debug():
    """
    Debug endpoint — call this to diagnose RAG issues.
    Visit: https://your-backend.onrender.com/rag/debug
    """
    try:
        from rag import get_collection_stats, list_ingested_sources, retrieve_documents
        stats   = get_collection_stats()
        sources = list_ingested_sources()

        # Test retrieval with a sample query
        test_chunks = retrieve_documents("relay protection fault current", k=3)

        return {
            "rag_ready":      rag_ready,
            "rag_error":      _rag_error,
            "collection":     stats,
            "ingested_files": sources,
            "test_retrieval": {
                "query":       "relay protection fault current",
                "chunks_found": len(test_chunks),
                "chunks": [
                    {
                        "score":   c["score"],
                        "source":  c["source"],
                        "page":    c["page"],
                        "preview": c["content"][:150] + "..."
                    }
                    for c in test_chunks
                ]
            }
        }
    except Exception as e:
        return {"error": str(e), "rag_ready": rag_ready, "rag_error": _rag_error}


@app.post("/chat")
async def chat(req: ChatRequest):
    if not OPENAI_API_KEY:
        raise HTTPException(503, "OPENAI_API_KEY not configured in .env")

    # ── RAG retrieval ───────────────────────────────────────
    rag_ctx      = ""
    rag_chunks_n = 0

    if req.use_rag and req.messages:
        if rag_ready and _retrieve_context:
            try:
                last_user_msg = req.messages[-1].content
                rag_ctx       = _retrieve_context(last_user_msg, k=8)
                # Count chunks retrieved
                rag_chunks_n  = rag_ctx.count("--- CHUNK ")
                print(f"[CHAT] RAG retrieved {rag_chunks_n} chunks for: '{last_user_msg[:60]}'")
            except Exception as e:
                print(f"[CHAT] RAG retrieval error: {e}")
        else:
            print(f"[CHAT] RAG skipped — rag_ready={rag_ready}, error={_rag_error}")

    messages = build_messages(req.messages, rag_ctx)

    # ── Stream response ─────────────────────────────────────
    if req.stream:
        async def stream_tokens() -> AsyncGenerator[str, None]:
            try:
                stream = await async_client.chat.completions.create(
                    model=MODEL,
                    messages=messages,
                    stream=True,
                    temperature=0.1,   # lower = more faithful to retrieved content
                    max_tokens=3000,
                )
                async for chunk in stream:
                    delta = chunk.choices[0].delta
                    if delta.content:
                        yield delta.content
            except Exception as e:
                yield f"\n\n*Error: {str(e)}*"
        return StreamingResponse(stream_tokens(), media_type="text/plain")

    # ── Non-streaming ───────────────────────────────────────
    resp = await async_client.chat.completions.create(
        model=MODEL, messages=messages, temperature=0.1, max_tokens=3000,
    )
    return {
        "response":      resp.choices[0].message.content,
        "rag_used":      bool(rag_ctx),
        "rag_chunks":    rag_chunks_n,
        "model":         MODEL,
        "tokens_used":   resp.usage.total_tokens if resp.usage else 0,
    }


@app.post("/calculate")
async def calculate(req: FaultCalcRequest):
    calc = run_fault_calc(req)

    if OPENAI_API_KEY:
        try:
            summary = "\n".join(
                f"Step {s['step']} - {s['title']}:\n{s['content']}"
                for s in calc["steps"]
            )
            ai_prompt = (
                f"I ran a {req.fault_type} fault calculation on a {req.voltage_kv} kV system.\n\n"
                f"{summary}\n\n"
                "Provide:\n"
                "1. Engineering interpretation of these fault current levels\n"
                "2. Implication for distance relay Zone 1 / Zone 2 settings\n"
                "3. Key protection observations"
            )
            resp = await async_client.chat.completions.create(
                model=MODEL,
                messages=build_messages([Message(role="user", content=ai_prompt)]),
                temperature=0.1, max_tokens=800,
            )
            calc["ai_interpretation"] = resp.choices[0].message.content
        except Exception as e:
            calc["ai_interpretation"] = f"(AI interpretation unavailable: {e})"
    else:
        calc["ai_interpretation"] = "(Set OPENAI_API_KEY in .env to enable AI interpretation)"

    return calc


@app.post("/upload")
async def upload_pdf(
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = BackgroundTasks(),
):
    """Upload a single PDF and ingest it into the vector database."""
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files accepted.")

    contents = await file.read()
    size_mb  = len(contents) / (1024 * 1024)
    if size_mb > MAX_UPLOAD_MB:
        raise HTTPException(413, f"File too large ({size_mb:.1f} MB). Max {MAX_UPLOAD_MB} MB.")

    save_path  = os.path.join(DOCS_DIR, file.filename)
    fname_copy = file.filename

    with open(save_path, "wb") as f:
        f.write(contents)
    print(f"[UPLOAD] Saved: {fname_copy} ({size_mb:.1f} MB)")

    def do_ingest():
        global rag_ready, _retrieve_context, _rag_error
        try:
            print(f"[INGEST] Starting ingestion of {fname_copy}")
            from ingest import ingest_single_pdf
            result = ingest_single_pdf(save_path)
            print(f"[INGEST] Result: {result}")

            if result.get("status") in ("success", "skipped"):
                from rag import retrieve_context, reload_vectorstore
                vs = reload_vectorstore()
                if vs:
                    _retrieve_context = retrieve_context
                    rag_ready = True
                    _rag_error = ""
                    print(f"[INGEST] RAG is now ready — {vs._collection.count()} total chunks")
                else:
                    _rag_error = "Vectorstore reload failed after ingestion"
                    print(f"[INGEST] ERROR: {_rag_error}")
            else:
                _rag_error = result.get("message", "Ingestion failed")
                print(f"[INGEST] FAILED: {_rag_error}")
        except Exception as e:
            _rag_error = str(e)
            print(f"[INGEST] EXCEPTION: {e}")

    background_tasks.add_task(do_ingest)

    return {
        "status":   "uploaded",
        "filename": file.filename,
        "size_mb":  round(size_mb, 2),
        "message":  "Saved. Ingestion started in background (~30s). Watch /rag/debug for status.",
    }


@app.post("/upload-multiple")
async def upload_multiple_pdfs(
    files: List[UploadFile] = File(...),
    background_tasks: BackgroundTasks = BackgroundTasks(),
):
    """Upload multiple PDFs at once."""
    results = []
    saved_paths = []

    for file in files:
        if not file.filename.lower().endswith(".pdf"):
            results.append({"filename": file.filename, "status": "skipped", "reason": "not a PDF"})
            continue

        contents = await file.read()
        size_mb  = len(contents) / (1024 * 1024)

        if size_mb > MAX_UPLOAD_MB:
            results.append({"filename": file.filename, "status": "skipped", "reason": f"too large ({size_mb:.1f} MB)"})
            continue

        save_path = os.path.join(DOCS_DIR, file.filename)
        with open(save_path, "wb") as f:
            f.write(contents)

        saved_paths.append(save_path)
        results.append({"filename": file.filename, "status": "saved", "size_mb": round(size_mb, 2)})
        print(f"[UPLOAD] Saved: {file.filename} ({size_mb:.1f} MB)")

    def ingest_all():
        global rag_ready, _retrieve_context, _rag_error
        for path in saved_paths:
            try:
                from ingest import ingest_single_pdf
                result = ingest_single_pdf(path)
                print(f"[INGEST] {os.path.basename(path)}: {result.get('status')}")
            except Exception as e:
                print(f"[INGEST] Error for {path}: {e}")
        # Reload once after all ingested
        try:
            from rag import retrieve_context, reload_vectorstore
            vs = reload_vectorstore()
            if vs:
                _retrieve_context = retrieve_context
                rag_ready = True
                _rag_error = ""
                print(f"[INGEST] All done — RAG ready with {vs._collection.count()} chunks")
        except Exception as e:
            _rag_error = str(e)
            print(f"[INGEST] Reload error: {e}")

    if saved_paths:
        background_tasks.add_task(ingest_all)

    return {
        "status":  "processing",
        "files":   results,
        "message": f"{len(saved_paths)} file(s) saved. Ingestion started. Check /rag/debug for status.",
    }


@app.get("/documents")
async def list_documents():
    if not os.path.exists(DOCS_DIR):
        return {"documents": [], "count": 0}
    docs = [
        {"filename": f, "size_mb": round(os.path.getsize(os.path.join(DOCS_DIR, f)) / (1024*1024), 2)}
        for f in os.listdir(DOCS_DIR) if f.endswith(".pdf")
    ]
    return {"documents": docs, "count": len(docs)}


@app.delete("/documents/{filename}")
async def delete_document(filename: str):
    path = os.path.join(DOCS_DIR, filename)
    if not os.path.exists(path):
        raise HTTPException(404, f"'{filename}' not found.")
    os.remove(path)
    rag_result = {}
    if rag_ready:
        try:
            from rag import delete_source
            rag_result = delete_source(filename)
        except Exception as e:
            rag_result = {"warning": str(e)}
    return {"status": "deleted", "filename": filename, "rag": rag_result}


@app.get("/rag/stats")
async def rag_stats():
    try:
        from rag import get_collection_stats, list_ingested_sources
        return {
            "stats":   get_collection_stats(),
            "sources": list_ingested_sources(),
        }
    except Exception as e:
        return {"error": str(e)}


if __name__ == "__main__":
    import uvicorn
    print("=" * 50)
    print("  Relay Protection AI Agent")
    print(f"  Model   : {MODEL}")
    print(f"  Base URL: {BASE_URL}")
    print(f"  API Key : {'Set' if OPENAI_API_KEY else 'MISSING'}")
    print("=" * 50)
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)