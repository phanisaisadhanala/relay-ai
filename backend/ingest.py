"""
ingest.py — Document Ingestion Pipeline
Relay Protection AI Agent

Handles:
  - PDF loading (single file or full docs/ folder)
  - Text splitting into optimized chunks
  - OpenAI embedding generation
  - ChromaDB vector storage
  - Progress reporting

Usage:
  # Ingest all PDFs in docs/ folder:
  python ingest.py

  # Ingest a specific file:
  python ingest.py --file docs/relay_manual.pdf

  # Force rebuild entire collection:
  python ingest.py --rebuild

  # Show collection stats only:
  python ingest.py --stats
"""

import os
import sys
import argparse
import hashlib
import time
from typing import List, Optional
from dotenv import load_dotenv

load_dotenv()

# ─────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────
OPENAI_API_KEY  = os.getenv("OPENAI_API_KEY", "")
DOCS_DIR        = os.path.join(os.path.dirname(__file__), "docs")
DB_DIR          = os.path.join(os.path.dirname(__file__), "vectordb")
COLLECTION_NAME = "relay_docs"
EMBED_MODEL     = "text-embedding-3-small"

# Chunking settings — tuned for relay engineering documents
CHUNK_SIZE      = 1000   # Characters per chunk
CHUNK_OVERLAP   = 200    # Overlap between consecutive chunks
BATCH_SIZE      = 50     # Chunks per embedding API call (saves rate limit)

# ─────────────────────────────────────────────────────────────
# PACKAGE CHECK
# ─────────────────────────────────────────────────────────────
def check_packages():
    required = {
        "langchain_community":  "langchain-community",
        "langchain_openai":     "langchain-openai",
        "langchain_chroma":     "langchain-chroma",
        "pypdf":                "pypdf",
        "chromadb":             "chromadb",
    }
    missing = []
    for mod, pkg in required.items():
        try:
            __import__(mod)
        except ImportError:
            missing.append(pkg)
    if missing:
        print(f"Missing packages. Run:")
        print(f"  pip install {' '.join(missing)}")
        sys.exit(1)

check_packages()

# ─────────────────────────────────────────────────────────────
# IMPORTS (after package check)
# ─────────────────────────────────────────────────────────────
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings
from langchain_chroma import Chroma
from langchain.schema import Document

# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────
def file_hash(path: str) -> str:
    """MD5 hash of a file — used to detect if a file has changed."""
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def print_banner(msg: str):
    line = "─" * 56
    print(f"\n{line}")
    print(f"  {msg}")
    print(f"{line}")


def print_step(n: int, msg: str):
    print(f"\n  [{n}] {msg}")


def progress_bar(current: int, total: int, width: int = 30) -> str:
    filled = int(width * current / total) if total > 0 else 0
    bar    = "█" * filled + "░" * (width - filled)
    pct    = int(100 * current / total) if total > 0 else 0
    return f"  [{bar}] {pct:3d}%  {current}/{total}"


# ─────────────────────────────────────────────────────────────
# LOAD PDF
# ─────────────────────────────────────────────────────────────
def load_pdf(path: str) -> List[Document]:
    """
    Load a PDF file using PyPDFLoader.
    Returns a list of Document objects (one per page).
    Adds source metadata to each document.
    """
    fname = os.path.basename(path)
    try:
        loader = PyPDFLoader(path)
        pages  = loader.load()

        # Enrich metadata
        for page in pages:
            page.metadata["source"]   = fname
            page.metadata["type"]     = "pdf"
            page.metadata["filepath"] = path

        return pages

    except Exception as e:
        print(f"    ERROR loading {fname}: {e}")
        return []


# ─────────────────────────────────────────────────────────────
# SPLIT DOCUMENTS
# ─────────────────────────────────────────────────────────────
def split_documents(documents: List[Document]) -> List[Document]:
    """
    Split document pages into smaller overlapping chunks.
    Uses RecursiveCharacterTextSplitter which respects sentence/paragraph
    boundaries — better than fixed-size splitting for technical docs.
    """
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        length_function=len,
        separators=[
            "\n\n",     # paragraph breaks first
            "\n",       # line breaks
            ". ",       # sentence endings
            ", ",       # clause breaks
            " ",        # word breaks last resort
            "",
        ],
    )
    chunks = splitter.split_documents(documents)

    # Add chunk_id to each chunk for tracking
    for i, chunk in enumerate(chunks):
        src = chunk.metadata.get("source", "unknown")
        pg  = chunk.metadata.get("page", 0)
        chunk.metadata["chunk_id"] = f"{src}_p{pg}_c{i}"

    return chunks


# ─────────────────────────────────────────────────────────────
# GET ALREADY-INGESTED SOURCES
# ─────────────────────────────────────────────────────────────
def get_ingested_sources(vectorstore: Chroma) -> set:
    """Return set of filenames already in the vectorstore."""
    try:
        data    = vectorstore._collection.get(include=["metadatas"])
        sources = set()
        for meta in data.get("metadatas", []):
            if meta and "source" in meta:
                sources.add(meta["source"])
        return sources
    except Exception:
        return set()


# ─────────────────────────────────────────────────────────────
# EMBED AND STORE — CORE FUNCTION
# ─────────────────────────────────────────────────────────────
def embed_and_store(
    chunks: List[Document],
    vectorstore: Chroma,
    source_name: str,
) -> int:
    """
    Embed chunks in batches and add them to ChromaDB.
    Returns number of chunks stored.
    """
    if not chunks:
        return 0

    total   = len(chunks)
    stored  = 0

    for start in range(0, total, BATCH_SIZE):
        batch = chunks[start : start + BATCH_SIZE]
        try:
            vectorstore.add_documents(batch)
            stored += len(batch)
            end = min(start + BATCH_SIZE, total)
            print(f"\r{progress_bar(end, total)}", end="", flush=True)
            # Small delay to respect OpenAI rate limits
            time.sleep(0.3)
        except Exception as e:
            print(f"\n    BATCH ERROR ({start}-{start+BATCH_SIZE}): {e}")
            # Retry once after a short wait
            time.sleep(2)
            try:
                vectorstore.add_documents(batch)
                stored += len(batch)
                print(f"    Retry succeeded for batch {start}-{start+BATCH_SIZE}")
            except Exception as e2:
                print(f"    Retry also failed: {e2}. Skipping batch.")

    print()  # newline after progress bar
    return stored


# ─────────────────────────────────────────────────────────────
# INGEST SINGLE PDF
# ─────────────────────────────────────────────────────────────
def ingest_single_pdf(
    pdf_path: str,
    force: bool = False,
) -> dict:
    """
    Ingest one PDF file into ChromaDB.
    Skips if already ingested (unless force=True).

    Called by:
      - main.py after /upload endpoint
      - ingest.py CLI for individual files
    """
    if not os.path.exists(pdf_path):
        return {"status": "error", "message": f"File not found: {pdf_path}"}

    if not OPENAI_API_KEY:
        return {"status": "error", "message": "OPENAI_API_KEY not set in .env"}

    fname = os.path.basename(pdf_path)
    print_banner(f"Ingesting: {fname}")

    # ── Step 1: Init embeddings + vectorstore ──────────────────
    print_step(1, "Initializing OpenAI embeddings...")
    try:
        embeddings = OpenAIEmbeddings(
            model=EMBED_MODEL,
            openai_api_key=OPENAI_API_KEY,
        )
    except Exception as e:
        return {"status": "error", "message": f"Embeddings init failed: {e}"}

    os.makedirs(DB_DIR, exist_ok=True)
    vectorstore = Chroma(
        collection_name=COLLECTION_NAME,
        persist_directory=DB_DIR,
        embedding_function=embeddings,
    )

    # ── Step 2: Check if already ingested ─────────────────────
    if not force:
        ingested = get_ingested_sources(vectorstore)
        if fname in ingested:
            chunk_count = vectorstore._collection.count()
            print(f"  Already ingested. Skipping (use --rebuild to force).")
            return {
                "status":      "skipped",
                "filename":    fname,
                "reason":      "already ingested",
                "total_chunks": chunk_count,
            }

    # ── Step 3: Load PDF ──────────────────────────────────────
    print_step(2, f"Loading PDF: {fname}")
    pages = load_pdf(pdf_path)
    if not pages:
        return {"status": "error", "message": f"Could not extract text from {fname}"}

    # Filter out pages with minimal content (e.g. blank pages, headers only)
    pages = [p for p in pages if len(p.page_content.strip()) > 50]
    print(f"     Loaded {len(pages)} pages with content")

    # ── Step 4: Split into chunks ─────────────────────────────
    print_step(3, "Splitting into chunks...")
    chunks = split_documents(pages)
    print(f"     Created {len(chunks)} chunks "
          f"(size={CHUNK_SIZE}, overlap={CHUNK_OVERLAP})")

    if not chunks:
        return {"status": "error", "message": "No text chunks created. Check if PDF has extractable text."}

    # ── Step 5: Embed and store ───────────────────────────────
    print_step(4, f"Embedding {len(chunks)} chunks → ChromaDB...")
    print(f"     Model: {EMBED_MODEL} | Batch size: {BATCH_SIZE}")
    t0 = time.time()
    stored = embed_and_store(chunks, vectorstore, fname)
    elapsed = time.time() - t0

    total_in_db = vectorstore._collection.count()
    print(f"     Stored {stored} chunks in {elapsed:.1f}s")
    print(f"     Total chunks in DB: {total_in_db}")

    print(f"\n  Done! '{fname}' is now searchable.")
    return {
        "status":        "success",
        "filename":      fname,
        "pages_loaded":  len(pages),
        "chunks_stored": stored,
        "total_chunks":  total_in_db,
        "elapsed_s":     round(elapsed, 1),
    }


# ─────────────────────────────────────────────────────────────
# INGEST ALL PDFs IN docs/ FOLDER
# ─────────────────────────────────────────────────────────────
def ingest_all(force: bool = False) -> List[dict]:
    """
    Scan docs/ folder and ingest all PDFs.
    Skips already-ingested files unless force=True.
    """
    if not os.path.exists(DOCS_DIR):
        os.makedirs(DOCS_DIR, exist_ok=True)
        print(f"Created docs/ folder at: {DOCS_DIR}")
        print("Add your PDF files there and run again.")
        return []

    pdf_files = [
        os.path.join(DOCS_DIR, f)
        for f in sorted(os.listdir(DOCS_DIR))
        if f.lower().endswith(".pdf")
    ]

    if not pdf_files:
        print(f"No PDF files found in: {DOCS_DIR}")
        print("Copy your relay manuals and standards PDFs into docs/ and run again.")
        return []

    print_banner(f"Ingesting {len(pdf_files)} PDF(s) from docs/")
    results = []
    for i, path in enumerate(pdf_files, 1):
        print(f"\n  File {i}/{len(pdf_files)}: {os.path.basename(path)}")
        result = ingest_single_pdf(path, force=force)
        results.append(result)

    # ── Summary ───────────────────────────────────────────────
    print_banner("Ingestion Summary")
    success = [r for r in results if r.get("status") == "success"]
    skipped = [r for r in results if r.get("status") == "skipped"]
    errors  = [r for r in results if r.get("status") == "error"]

    print(f"  Processed : {len(results)} file(s)")
    print(f"  Success   : {len(success)}")
    print(f"  Skipped   : {len(skipped)} (already ingested)")
    print(f"  Errors    : {len(errors)}")

    if success:
        total_chunks = sum(r.get("chunks_stored", 0) for r in success)
        print(f"  New chunks: {total_chunks}")

    if errors:
        print("\n  Errors:")
        for r in errors:
            print(f"    - {r.get('filename','?')}: {r.get('message','unknown error')}")

    return results


# ─────────────────────────────────────────────────────────────
# REBUILD — WIPE AND RE-INGEST ALL
# ─────────────────────────────────────────────────────────────
def rebuild_collection():
    """
    Delete the entire vectordb/ and re-ingest all docs/ PDFs.
    Use when you have updated documents or changed chunking settings.
    """
    import shutil
    print_banner("Rebuilding Vector Collection")
    print("  WARNING: This will DELETE all ingested data and re-process everything.")
    confirm = input("  Type 'yes' to confirm: ").strip().lower()
    if confirm != "yes":
        print("  Cancelled.")
        return

    if os.path.exists(DB_DIR):
        shutil.rmtree(DB_DIR)
        print(f"  Deleted: {DB_DIR}")
    os.makedirs(DB_DIR, exist_ok=True)
    print("  Starting fresh ingestion...")
    ingest_all(force=True)


# ─────────────────────────────────────────────────────────────
# COLLECTION STATS
# ─────────────────────────────────────────────────────────────
def show_stats():
    """Print current collection statistics."""
    print_banner("ChromaDB Collection Stats")

    if not os.path.exists(DB_DIR):
        print(f"  No vectordb found at: {DB_DIR}")
        print("  Run: python ingest.py")
        return

    if not OPENAI_API_KEY:
        print("  OPENAI_API_KEY not set. Cannot connect.")
        return

    try:
        embeddings = OpenAIEmbeddings(
            model=EMBED_MODEL,
            openai_api_key=OPENAI_API_KEY,
        )
        vs = Chroma(
            collection_name=COLLECTION_NAME,
            persist_directory=DB_DIR,
            embedding_function=embeddings,
        )
        count = vs._collection.count()
        data  = vs._collection.get(include=["metadatas"])

        # Count per source
        source_counts: dict = {}
        for meta in data.get("metadatas", []):
            if meta:
                src = meta.get("source", "unknown")
                source_counts[src] = source_counts.get(src, 0) + 1

        print(f"  DB path        : {DB_DIR}")
        print(f"  Collection     : {COLLECTION_NAME}")
        print(f"  Total chunks   : {count}")
        print(f"  Embed model    : {EMBED_MODEL}")
        print(f"  Chunk size     : {CHUNK_SIZE} chars")
        print(f"  Chunk overlap  : {CHUNK_OVERLAP} chars")
        print(f"\n  Sources ({len(source_counts)}):")
        for src, cnt in sorted(source_counts.items()):
            print(f"    {cnt:5d} chunks  ←  {src}")

    except Exception as e:
        print(f"  Error: {e}")


# ─────────────────────────────────────────────────────────────
# CLI ENTRY POINT
# ─────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Relay AI Agent — Document Ingestion Pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python ingest.py                              # Ingest all PDFs in docs/
  python ingest.py --file docs/manual.pdf       # Ingest one file
  python ingest.py --rebuild                    # Wipe + re-ingest all
  python ingest.py --stats                      # Show DB statistics
  python ingest.py --stats --file docs/x.pdf   # Ingest + show stats
        """
    )
    parser.add_argument("--file",    type=str,  help="Path to a specific PDF to ingest")
    parser.add_argument("--rebuild", action="store_true", help="Wipe collection and re-ingest all")
    parser.add_argument("--stats",   action="store_true", help="Show collection statistics")
    parser.add_argument("--force",   action="store_true", help="Re-ingest even if already stored")
    args = parser.parse_args()

    # Validate API key
    if not OPENAI_API_KEY and not args.stats:
        print("ERROR: OPENAI_API_KEY not set.")
        print("Add it to backend/.env:  OPENAI_API_KEY=sk-proj-...")
        sys.exit(1)

    print_banner("Relay Protection AI Agent — Ingestion Pipeline")
    print(f"  Docs folder  : {DOCS_DIR}")
    print(f"  Vector DB    : {DB_DIR}")
    print(f"  Embed model  : {EMBED_MODEL}")
    print(f"  Chunk size   : {CHUNK_SIZE}  |  Overlap: {CHUNK_OVERLAP}")
    print(f"  API Key      : {'Set' if OPENAI_API_KEY else 'MISSING'}")

    if args.rebuild:
        rebuild_collection()
    elif args.file:
        result = ingest_single_pdf(args.file, force=args.force)
        print(f"\n  Result: {result}")
    else:
        ingest_all(force=args.force)

    if args.stats:
        show_stats()

    print("\n  Done! Restart main.py to use updated knowledge base.\n")


if __name__ == "__main__":
    main()