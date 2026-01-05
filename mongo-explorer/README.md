
# mongo-explorer

# mongo-explorer

A public demo is available at https://mongo-viewer.federici.me/ — it runs entirely in the browser, does not save any user data, and includes a default sample dataset you can load from the site to explore all features.

React + Vite frontend for visualizing MongoDB schema reports produced by
`mongo-scanner`. The UI presents a C4-style navigation (cluster → database →
collection → fields) with exporting and schema generation helpers.

Quick start
-----------

Prerequisites
- Node.js 18+ (Node 25 recommended for development)
- npm or yarn

Run in development

```bash
cd mongo-explorer
npm install
npm run dev
# open http://localhost:5173
```

Production build

```bash
cd mongo-explorer
npm run build
# built files are output to `dist/`
```

Features
--------
- C4-style navigation: cluster → database → collection → fields
- Field type inference and presence frequency metrics
- Export collection schema as JSON
- Export visualizations as PNG and PDF
- Generate Go structs for a selected collection
- Upload/Load a schema JSON file (e.g., `public/sample-schema.json`)

Files of interest
- `index.html`, `index.tsx`, `App.tsx` — app entry and mounting
- `utils.ts`, `types.ts`, `metadata.json` — helper types and metadata
- `components/` — UI components like charts and schema views
- `views/` — top-level views for C4 navigation
- `public/sample-schema.json` — sample data for quick testing (if present)


Deploy script (`deploy.sh`)
-------------------------

`deploy.sh` is a convenience script that automates building the frontend and
publishing the `dist/` output to an S3 bucket (and optionally invalidating a
CloudFront distribution). The README below documents the exact behavior and
example commands; inspect `deploy.sh` before running in your environment.

Typical high-level steps performed by the script (two modes):

- `init` (initial launch):
  1. Runs `npm run build` to produce `dist/`.
  2. Optionally creates the S3 bucket: `aws s3 mb s3://<bucket>`.
  3. Optionally updates the S3 public-access-block to allow uploads (see
     examples below).
  4. Syncs `dist/` to the bucket: `aws s3 sync dist/ s3://<bucket> --delete`.
  5. Optionally configures bucket policy or origin access settings for
     CloudFront.
  6. Optionally creates/configures a CloudFront distribution (or guides you
     to create one via the console).

- `update` (push only updates):
  1. Runs `npm run build`.
  2. Syncs `dist/` to the bucket: `aws s3 sync dist/ s3://<bucket> --delete`.
  3. Optionally triggers a CloudFront invalidation: `aws cloudfront
     create-invalidation --distribution-id <dist-id> --paths '/*'`.

Example wrapper commands (placeholders you can run locally):

Initial launch (creates bucket, uploads, optional CloudFront setup):

```bash
cd mongo-explorer
chmod +x deploy.sh
./deploy.sh init --bucket <bucket-name> --region <aws-region> --profile <aws-profile>
```

Update files only (sync `dist/` and invalidate CloudFront):

```bash
cd mongo-explorer
./deploy.sh update --bucket <bucket-name> --profile <aws-profile> --invalidate <cloudfront-distribution-id>
```

Exact AWS CLI commands you may see the script run (or should run manually):

# build
npm run build

# optionally disable public access block to allow initial config/uploads
aws s3api put-public-access-block \
  --bucket <bucket-name> \
  --public-access-block-configuration '{"BlockPublicAcls":false,"IgnorePublicAcls":false,"BlockPublicPolicy":false,"RestrictPublicBuckets":false}' \
  --profile <aws-profile>

# create bucket (if needed)
aws s3 mb s3://<bucket-name> --region <aws-region> --profile <aws-profile>

# sync files
aws s3 sync dist/ s3://<bucket-name> --delete --profile <aws-profile>

# (recommended) re-enable public access block or configure policy for CloudFront
aws s3api put-public-access-block \
  --bucket <bucket-name> \
  --public-access-block-configuration '{"BlockPublicAcls":true,"IgnorePublicAcls":true,"BlockPublicPolicy":true,"RestrictPublicBuckets":true}' \
  --profile <aws-profile>

# invalidate CloudFront to ensure new content is served
aws cloudfront create-invalidation --distribution-id <distribution-id> --paths '/*' --profile <aws-profile>

Notes and important guidance
----------------------------

- CloudFront & Route 53: After creating a CloudFront distribution that points
  to the S3 bucket as its origin, create the DNS records in Route 53 that map
  your domain to the CloudFront distribution domain name (`<dist-id>.cloudfront.net`).
  You typically create an alias A/AAAA record in Route 53 pointing to the
  CloudFront distribution. Use the CloudFront console or AWS CLI to obtain the
  distribution domain name and then create the Route 53 records.

- Public access block: S3 buckets are often created with a public-access-block
  enabled. Depending on your deployment approach you may need to temporarily
  disable the public-access-block to upload or configure bucket policies, and
  then re-enable it. Example commands to toggle are shown above.

- Security note: For production sites, prefer serving via CloudFront with an
  Origin Access Control (OAC) or Origin Access Identity (OAI) rather than
  making the bucket public. If you use OAC/OAI, update the bucket policy to
  allow CloudFront to read objects and keep the public access block enabled.

- For step-by-step, CI integration, and environment-variable options see
  `DEPLOY.md` in this folder which includes extra examples for automation.

S3 static website hosting (manual step)
---------------------------------------

If you intend to host the site directly as an S3 static website (rather than
serving through CloudFront), you must enable website hosting on the bucket
after deployment. This is a manual step (console or CLI) and usually looks
like:

```bash
# enable static website hosting (CLI)
aws s3 website s3://<bucket-name> --index-document index.html --error-document index.html --profile <aws-profile>
```

Or enable the `Static website hosting` option in the S3 console under the
bucket `Properties` tab and set `index.html` (and an error document if
desired).

Note: when using S3 website hosting the bucket becomes a public website
endpoint — ensure you understand the public access settings and bucket
policy implications. If you previously disabled the public access block to
upload files, remember to re-enable or properly configure policies after the
site is available.

Contributing
------------
- Open issues or PRs against this folder for UI improvements or export
  additions. Keep exported schema format stable where possible.

License
-------
MIT — see the repository root `README.md` for the full license text.

