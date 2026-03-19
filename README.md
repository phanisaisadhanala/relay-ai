# ⚡ Relay Protection AI Agent

AI assistant for relay protection engineering — fault analysis, relay settings, CAPE/VBA macros.

---

## Project Structure

```
relay-ai/
├── backend/
│   ├── main.py          ← FastAPI server
│   ├── rag.py           ← ChromaDB retrieval engine
│   ├── ingest.py        ← PDF ingestion pipeline
│   ├── system_prompt.txt← AI system prompt
│   ├── requirements.txt ← Python dependencies
│   ├── .env             ← API keys (YOU MUST EDIT THIS)
│   ├── docs/            ← (created at runtime) uploaded PDFs go here
│   └── vectordb/        ← (created at runtime) ChromaDB storage
└── frontend/
    ├── public/index.html
    ├── package.json
    └── src/
        ├── App.jsx
        ├── index.js
        └── components/
            ├── ChatWindow.jsx
            ├── MessageBubble.jsx
            ├── FaultCalc.jsx
            ├── UploadPanel.jsx
            └── StatusBar.jsx
```

---

## Setup

### 1. Backend

```bash
cd backend
pip install -r requirements.txt

# Edit .env and add your OpenAI API key:
# OPENAI_API_KEY=sk-proj-YOUR_KEY_HERE

uvicorn main:app --reload --port 8000
```

### 2. Frontend

```bash
cd frontend
npm install
npm start
```

Opens at http://localhost:3000

---

## Features

| Tab | Feature |
|-----|---------|
| ⚡ Chat | Ask relay engineering questions (GPT-4o-mini) |
| 🔢 Fault Calculator | SLG / LL / DLG / 3PH sequence network calculations |
| 📄 Documents | Upload PDFs → ChromaDB RAG |

---

## Bug Fixes Applied (from original upload)

1. **`StatusBar.jsx` was empty** — fully implemented
2. **`system_prmpt.txt` filename mismatch** — renamed to `system_prompt.txt` (matches `main.py`)
3. **`ingest.py` deprecated import** — `langchain.text_splitter` → `langchain_text_splitters`
4. **`main.py` upload route** — `global` declaration inside nested function moved correctly
5. **`ChatWindow.jsx` `setLoading(false)`** — moved into `finally` block to always execute
6. **`.env` file** — template created (was empty in upload)
7. **`requirements.txt`** — `langchain-text-splitters` added as explicit dependency
