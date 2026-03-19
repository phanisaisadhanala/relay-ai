"""
rag.py — RAG Retrieval Engine
Relay Protection AI Agent

Handles:
  - Vector store initialization
  - Document retrieval (similarity search)
  - Context formatting for prompt injection
  - Collection management utilities

Used by main.py at query time.
"""

import os
import re
from typing import List, Optional
from dotenv import load_dotenv

load_dotenv()

# ─────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────
OPENAI_API_KEY   = os.getenv("OPENAI_API_KEY", "")
DB_DIR           = os.path.join(os.path.dirname(__file__), "vectordb")
COLLECTION_NAME  = "relay_docs"
EMBED_MODEL      = "text-embedding-3-small"   # Fast, cheap, 1536-dim
TOP_K_DEFAULT    = 5                           # Chunks to retrieve per query
MAX_CONTEXT_CHARS= 6000                        # Cap on injected context length

# ─────────────────────────────────────────────────────────────
# LAZY-LOADED VECTOR STORE
# Initialized once on first call, reused after that.
# ─────────────────────────────────────────────────────────────
_vectorstore     = None
_embeddings_obj  = None

def _get_embeddings():
    """Return (and cache) the OpenAI embeddings object."""
    global _embeddings_obj
    if _embeddings_obj is None:
        if not OPENAI_API_KEY:
            raise RuntimeError(
                "OPENAI_API_KEY not set. Cannot create embeddings. "
                "Add it to backend/.env"
            )
        from langchain_openai import OpenAIEmbeddings
        _embeddings_obj = OpenAIEmbeddings(
            model=EMBED_MODEL,
            openai_api_key=OPENAI_API_KEY,
        )
    return _embeddings_obj


def _get_vectorstore(force_reload: bool = False):
    """
    Return (and cache) the Chroma vectorstore.
    Raises RuntimeError if vectordb/ does not exist yet
    (i.e. no documents have been ingested).
    """
    global _vectorstore
    if _vectorstore is not None and not force_reload:
        return _vectorstore

    if not os.path.exists(DB_DIR):
        raise RuntimeError(
            f"Vector database not found at '{DB_DIR}'. "
            "Upload a PDF via POST /upload or run: python ingest.py"
        )

    # Check the directory is not empty
    contents = os.listdir(DB_DIR)
    if not contents:
        raise RuntimeError(
            f"Vector database directory '{DB_DIR}' is empty. "
            "Run python ingest.py to populate it."
        )

    from langchain_chroma import Chroma
    _vectorstore = Chroma(
        collection_name=COLLECTION_NAME,
        persist_directory=DB_DIR,
        embedding_function=_get_embeddings(),
    )
    count = _vectorstore._collection.count()
    print(f"[RAG] Loaded vectorstore — {count} chunks in collection '{COLLECTION_NAME}'")
    return _vectorstore


def reload_vectorstore():
    """Force reload the vectorstore (call after new documents are ingested)."""
    global _vectorstore
    _vectorstore = None
    return _get_vectorstore(force_reload=True)


# ─────────────────────────────────────────────────────────────
# QUERY PREPROCESSING
# ─────────────────────────────────────────────────────────────
# Technical relay engineering terms to boost retrieval quality.
RELAY_KEYWORDS = {
    "zone 1", "zone 2", "zone 3", "zone reach",
    "distance relay", "overcurrent", "differential",
    "87t", "87l", "slg", "llg", "dlg", "3ph",
    "fault current", "impedance", "ct ratio", "pt ratio",
    "cape macro", "cupl", "vba", "cape application",
    "pott", "putt", "dcb", "pilot scheme",
    "idmt", "tms", "pickup", "sel-421", "sel-411",
    "nerc prc", "prc-023", "prc-026", "prc-027",
    "infeed", "sequence network", "positive sequence",
    "negative sequence", "zero sequence",
    "coordination", "relay setting", "protection",
}

def _expand_query(query: str) -> str:
    """
    Append relevant domain keywords to improve embedding similarity.
    Only adds terms that are NOT already in the query.
    """
    q_lower = query.lower()
    extras  = [kw for kw in RELAY_KEYWORDS if kw not in q_lower]

    # Limit expansion — too many extras dilutes the embedding
    expansion = ", ".join(extras[:8])
    return f"{query} [context: relay protection engineering, {expansion}]"


# ─────────────────────────────────────────────────────────────
# RETRIEVAL
# ─────────────────────────────────────────────────────────────
def retrieve_documents(
    query: str,
    k: int = TOP_K_DEFAULT,
    score_threshold: float = 0.30,
    expand_query: bool = True,
) -> List[dict]:
    """
    Retrieve the top-k most relevant document chunks for a query.

    Returns a list of dicts:
        {
          "content":  str,       # chunk text
          "source":   str,       # filename
          "page":     int|str,   # page number if available
          "score":    float,     # similarity score (0–1, higher = more relevant)
          "chunk_id": str,       # unique chunk identifier
        }

    Returns [] if vectorstore is not ready.
    """
    try:
        vs = _get_vectorstore()
    except RuntimeError as e:
        print(f"[RAG] Vectorstore not ready: {e}")
        return []

    # Optionally expand query with domain keywords
    search_query = _expand_query(query) if expand_query else query

    try:
        # similarity_search_with_relevance_scores returns (doc, score) pairs
        results = vs.similarity_search_with_relevance_scores(
            search_query,
            k=k,
        )
    except Exception as e:
        print(f"[RAG] Search error: {e}")
        return []

    chunks = []
    for doc, score in results:
        # Filter out very low-relevance results
        if score < score_threshold:
            continue
        chunks.append({
            "content":  doc.page_content,
            "source":   doc.metadata.get("source", "unknown"),
            "page":     doc.metadata.get("page", "—"),
            "sheet":    doc.metadata.get("sheet", ""),
            "doc_type": doc.metadata.get("type", "pdf"),
            "score":    round(score, 4),
            "chunk_id": doc.metadata.get("chunk_id", ""),
        })

    # Sort by relevance score descending
    chunks.sort(key=lambda x: x["score"], reverse=True)
    return chunks


def retrieve_context(
    query: str,
    k: int = TOP_K_DEFAULT,
) -> str:
    """
    High-level function used by main.py.
    Returns a formatted string ready to inject into the system prompt.
    """
    chunks = retrieve_documents(query, k=k)

    if not chunks:
        return ""

    parts = []
    total_chars = 0

    for i, chunk in enumerate(chunks, 1):
        source_label = f"{chunk['source']}"
        if chunk["page"] != "—":
            source_label += f", page {chunk['page']}"
        if chunk.get("sheet"):
            source_label += f", sheet: {chunk['sheet']}"

        block = (
            f"[Document {i} | Source: {source_label} | Relevance: {chunk['score']:.2f}]\n"
            f"{chunk['content'].strip()}"
        )

        # Respect context length cap
        if total_chars + len(block) > MAX_CONTEXT_CHARS:
            break

        parts.append(block)
        total_chars += len(block)

    if not parts:
        return ""

    return "\n\n---\n\n".join(parts)


# ─────────────────────────────────────────────────────────────
# UTILITY FUNCTIONS
# ─────────────────────────────────────────────────────────────
def get_collection_stats() -> dict:
    """Return stats about the current vector collection."""
    try:
        vs = _get_vectorstore()
        count = vs._collection.count()
        return {
            "ready":           True,
            "collection":      COLLECTION_NAME,
            "chunk_count":     count,
            "db_path":         DB_DIR,
            "embed_model":     EMBED_MODEL,
        }
    except RuntimeError as e:
        return {
            "ready":   False,
            "error":   str(e),
            "db_path": DB_DIR,
        }


def list_ingested_sources() -> List[str]:
    """Return unique filenames of all ingested documents."""
    try:
        vs   = _get_vectorstore()
        data = vs._collection.get(include=["metadatas"])
        sources = set()
        for meta in data.get("metadatas", []):
            if meta and "source" in meta:
                sources.add(meta["source"])
        return sorted(list(sources))
    except Exception as e:
        print(f"[RAG] Could not list sources: {e}")
        return []


def delete_source(filename: str) -> dict:
    """
    Remove all chunks belonging to a specific source file.
    Used when a document is deleted via DELETE /documents/{filename}.
    """
    try:
        vs   = _get_vectorstore()
        data = vs._collection.get(include=["metadatas"])
        ids_to_delete = []
        for i, meta in enumerate(data.get("metadatas", [])):
            if meta and meta.get("source") == filename:
                ids_to_delete.append(data["ids"][i])

        if ids_to_delete:
            vs._collection.delete(ids=ids_to_delete)
            print(f"[RAG] Deleted {len(ids_to_delete)} chunks for '{filename}'")
            return {"deleted": len(ids_to_delete), "source": filename}
        return {"deleted": 0, "source": filename, "note": "No chunks found for this source"}
    except Exception as e:
        return {"error": str(e), "source": filename}


def reset_collection() -> dict:
    """
    Wipe the entire vector collection.
    WARNING: This deletes ALL ingested documents.
    """
    global _vectorstore
    try:
        import shutil
        if os.path.exists(DB_DIR):
            shutil.rmtree(DB_DIR)
            os.makedirs(DB_DIR, exist_ok=True)
        _vectorstore = None
        print("[RAG] Collection reset — all chunks deleted")
        return {"status": "reset", "message": "All documents cleared from vector store"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


# ─────────────────────────────────────────────────────────────
# STANDALONE TEST
# ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 55)
    print("RAG Retrieval Engine — Test Mode")
    print("=" * 55)

    stats = get_collection_stats()
    print(f"\nCollection stats:")
    for k, v in stats.items():
        print(f"  {k:15s}: {v}")

    if stats.get("ready"):
        sources = list_ingested_sources()
        print(f"\nIngested sources ({len(sources)}):")
        for s in sources:
            print(f"  - {s}")

        test_queries = [
            "What is Zone 1 reach calculation for distance relay?",
            "How to write a CAPE macro to export relay settings?",
            "Calculate SLG fault current",
            "What is NERC PRC-023 relay loadability requirement?",
        ]

        print("\n--- Retrieval Test ---")
        for q in test_queries:
            print(f"\nQuery: {q}")
            ctx = retrieve_context(q, k=2)
            if ctx:
                preview = ctx[:200].replace("\n", " ")
                print(f"Context preview: {preview}...")
            else:
                print("No context retrieved")
    else:
        print("\nVectorstore not ready. Run: python ingest.py")