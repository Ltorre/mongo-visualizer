# mongo-explorer

This folder contains the project files for Mongo Explorer — a small toolkit
to scan MongoDB clusters and visualize inferred schema using a C4-style
navigation (cluster → database → collection → fields).

Contents
- `mongo-scanner/` — Go CLI that samples a MongoDB cluster and exports a
  JSON schema report
- `mongo-explorer/` — React + Vite frontend that loads the JSON report and
  provides an interactive UI

Quick start
-----------

Prerequisites
- Go 1.21+
- Node.js (18+; Node 25 recommended for dev)
- npm or yarn

1) Generate a schema (backend)

```bash
cd mongo-scanner
# example (replace URI with your connection string)
go run main.go scan --uri "mongodb+srv://<user>:<pass>@cluster.mongodb.net" --output ../sample-schema.json
```

2) Run the frontend (dev)

```bash
cd mongo-explorer
# install deps once
npm install
# run dev server
npm run dev
# open http://localhost:5173
```

3) Visualize
- Upload the generated `sample-schema.json` (or `public/sample-schema.json`) in the UI
  and navigate the C4 levels.

Production build

```bash
cd mongo-explorer
npm run build
```

Notes
-----
- The frontend supports exporting JSON, PNG, PDF, and generating Go structs for a collection.
- Sample schema for quick testing: `mongo-explorer/public/sample-schema.json`.

License
-------
This project is licensed under the MIT License. See the repository `README.md`
for the full license text.

