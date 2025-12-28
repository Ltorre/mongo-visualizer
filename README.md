
# mongo-viewer

This repository contains two related tools for generating and visualizing
MongoDB schema information:

- `mongo-scanner/` — a Go CLI that samples a MongoDB cluster and exports a
	detailed schema report (JSON/YAML/CSV).
- `mongo-explorer/` — a React + Vite frontend that loads a schema report and
	provides an interactive C4-style navigation (cluster → database →
	collection → fields) and export tools.

Quick start
-----------

- Prerequisites
- Go 1.24+
- Node.js 18+ (Node 25 recommended for development)
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
- Upload the generated `sample-schema.json` (or `public/sample-schema.json`) in
	the UI and navigate the C4 levels.

Production build

```bash
cd mongo-explorer
npm run build
```

Where to read more
- Scanner details: [mongo-scanner/README.md](mongo-scanner/README.md)
- Explorer details: [mongo-explorer/README.md](mongo-explorer/README.md)

- Hosting helper: `mongo-explorer` contains a `deploy.sh` helper script that
	can publish the built site to S3 (static website) or sync to an S3 origin
	for CloudFront — see [mongo-explorer/README.md](mongo-explorer/README.md)
	for exact commands and notes.

License
-------
MIT License — see the license text in this repository.


