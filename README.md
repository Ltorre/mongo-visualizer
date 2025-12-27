# mongo-explorer

Mongo Explorer (mongo-explorer) — a small toolkit to scan MongoDB clusters
and visualize inferred schema using a C4-style navigation (cluster → database → collection → fields).

Contents
- `mongo-scanner/` — Go CLI that samples a MongoDB cluster and exports a JSON schema report
- `mongo-explorer/` — React + Vite frontend that loads the JSON report and provides an interactive UI

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
cd ../mongo-explorer
# install deps once
npm install
# run dev server
npm run dev
# open http://localhost:5173
```

3) Visualize
- Upload the generated `sample-schema.json` (or `public/sample-schema.json`) in the UI and navigate the C4 levels.

Production build

```bash
cd mongo-explorer
npm run build
```

The frontend supports exporting JSON, PNG, PDF, and generating Go structs for a collection.

Contributing
------------
- Open issues or PRs against the repository.
- Keep schema export stable; include sample schema when filing issues.


License
-------
MIT License

Copyright (c) 2025

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

