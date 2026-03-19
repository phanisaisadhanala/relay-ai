"""
rag.py — RAG Retrieval Engine
Fixed: Uses OpenRouter for BOTH chat AND embeddings (same key, same URL)
Embedding model: openai/text-embedding-3-small via OpenRouter
"""

import os
from typing import List
from dotenv import load_dotenv

load_dotenv()

# ─────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────
OPENAI_API_KEY  = os.getenv("OPENAI_API_KEY", "")
BASE_URL        = os.getenv("OPENAI_BASE_URL", "https://openrouter.ai/api/v1")

# OpenRouter embedding model — same key, same URL, no extra account needed
EMBED_MODEL     = "openai/text-embedding-3-small"

DB_DIR          = os.path.join(os.path.dirname(__file__), "vectordb")
COLLECTION_NAME = "relay_docs"
TOP_K           = 8
SCORE_THRESHOLD = 0.15
MAX_CTX_CHARS   = 14000

# ─────────────────────────────────────────────────────────────
# SINGLETONS
# ─────────────────────────────────────────────────────────────
_vectorstore    = None
_embeddings_obj = None


def _get_embeddings():
    """
    Returns embeddings using OpenRouter.
    Same API key and base URL as chat — no separate account needed.
    """
    global _embeddings_obj
    if _embeddings_obj is None:
        if not OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY not set in .env")

        from langchain_openai import OpenAIEmbeddings
        _embeddings_obj = OpenAIEmbeddings(
            model=EMBED_MODEL,
            openai_api_key=OPENAI_API_KEY,
            openai_api_base=BASE_URL,   # OpenRouter handles embeddings fine
        )
        print(f"[RAG] Embeddings: {EMBED_MODEL} via {BASE_URL}")
    return _embeddings_obj


def _get_vectorstore(force_reload: bool = False):
    global _vectorstore
    if _vectorstore is not None and not force_reload:
        return _vectorstore

    if not os.path.exists(DB_DIR):
        raise RuntimeError(
            f"vectordb/ not found. Upload a PDF via the Documents tab first."
        )

    contents = [f for f in os.listdir(DB_DIR) if not f.startswith('.')]
    if not contents:
        raise RuntimeError("vectordb/ is empty — upload a PDF first.")

    from langchain_chroma import Chroma
    _vectorstore = Chroma(
        collection_name=COLLECTION_NAME,
        persist_directory=DB_DIR,
        embedding_function=_get_embeddings(),
    )
    count = _vectorstore._collection.count()
    print(f"[RAG] Vectorstore loaded — {count} chunks in '{COLLECTION_NAME}'")

    if count == 0:
        raise RuntimeError(
            "Vectorstore has 0 chunks. Re-upload your PDF — ingestion may have failed."
        )

    return _vectorstore


def reload_vectorstore():
    global _vectorstore
    _vectorstore = None
    try:
        vs = _get_vectorstore(force_reload=True)
        print(f"[RAG] Reloaded — {vs._collection.count()} chunks")
        return vs
    except Exception as e:
        print(f"[RAG] Reload failed: {e}")
        return None


# ─────────────────────────────────────────────────────────────
# RETRIEVAL
# ─────────────────────────────────────────────────────────────

def retrieve_documents(query: str, k: int = TOP_K) -> List[dict]:
    try:
        vs = _get_vectorstore()
    except RuntimeError as e:
        print(f"[RAG] NOT READY: {e}")
        return []

    print(f"[RAG] Searching: '{query[:80]}'")

    try:
        results = vs.similarity_search_with_relevance_scores(query.strip(), k=k)
    except Exception as e:
        print(f"[RAG] Search error: {e}")
        return []

    chunks = []
    seen   = set()

    for doc, score in results:
        print(f"[RAG]   score={score:.4f} | {doc.metadata.get('source','?')} p{doc.metadata.get('page','?')}")

        if score < SCORE_THRESHOLD:
            print(f"[RAG]   → below threshold, skipped")
            continue

        key = doc.page_content[:120].strip()
        if key in seen:
            continue
        seen.add(key)

        chunks.append({
            "content":  doc.page_content,
            "source":   doc.metadata.get("source", "unknown"),
            "page":     doc.metadata.get("page", "—"),
            "score":    round(score, 4),
            "chunk_id": doc.metadata.get("chunk_id", ""),
        })

    chunks.sort(key=lambda x: x["score"], reverse=True)
    print(f"[RAG] {len(chunks)} chunks passed threshold")
    return chunks


def retrieve_context(query: str, k: int = TOP_K) -> str:
    chunks = retrieve_documents(query, k=k)

    if not chunks:
        print(f"[RAG] WARNING: 0 chunks retrieved for: '{query[:60]}'")
        return ""

    parts       = []
    total_chars = 0

    for i, chunk in enumerate(chunks, 1):
        source = chunk['source']
        if chunk["page"] != "—":
            source += f" — page {chunk['page']}"

        block = (
            f"--- CHUNK {i} | {source} | relevance={chunk['score']:.2f} ---\n"
            f"{chunk['content'].strip()}\n"
            f"--- END CHUNK {i} ---"
        )

        if total_chars + len(block) > MAX_CTX_CHARS:
            break

        parts.append(block)
        total_chars += len(block)

    print(f"[RAG] Context built: {len(parts)} chunks, {total_chars} chars")
    return "\n\n".join(parts)


# ─────────────────────────────────────────────────────────────
# UTILITIES
# ─────────────────────────────────────────────────────────────

def get_collection_stats() -> dict:
    try:
        vs    = _get_vectorstore()
        count = vs._collection.count()
        data  = vs._collection.get(include=["metadatas"])
        sources = {}
        for meta in data.get("metadatas", []):
            if meta and "source" in meta:
                src = meta["source"]
                sources[src] = sources.get(src, 0) + 1
        return {
            "ready":       True,
            "collection":  COLLECTION_NAME,
            "chunk_count": count,
            "sources":     sources,
            "db_path":     DB_DIR,
            "embed_model": EMBED_MODEL,
            "embed_url":   BASE_URL,
        }
    except RuntimeError as e:
        return {"ready": False, "error": str(e), "db_path": DB_DIR}


def list_ingested_sources() -> List[str]:
    try:
        vs   = _get_vectorstore()
        data = vs._collection.get(include=["metadatas"])
        sources = set()
        for meta in data.get("metadatas", []):
            if meta and "source" in meta:
                sources.add(meta["source"])
        return sorted(list(sources))
    except Exception as e:
        print(f"[RAG] list_sources error: {e}")
        return []


def delete_source(filename: str) -> dict:
    try:
        vs   = _get_vectorstore()
        data = vs._collection.get(include=["metadatas"])
        ids_to_delete = [
            data["ids"][i]
            for i, meta in enumerate(data.get("metadatas", []))
            if meta and meta.get("source") == filename
        ]
        if ids_to_delete:
            vs._collection.delete(ids=ids_to_delete)
            return {"deleted": len(ids_to_delete), "source": filename}
        return {"deleted": 0, "source": filename}
    except Exception as e:
        return {"error": str(e), "source": filename}


def reset_collection() -> dict:
    global _vectorstore
    try:
        import shutil
        if os.path.exists(DB_DIR):
            shutil.rmtree(DB_DIR)
        os.makedirs(DB_DIR, exist_ok=True)
        _vectorstore = None
        return {"status": "reset"}
    except Exception as e:
        return {"status": "error", "error": str(e)}