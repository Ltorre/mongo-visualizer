# Deploying `mongo-explorer` to S3 (static website) + CloudFront

This guide shows a minimal, practical flow to host the built `mongo-explorer`
single-page app (SPA) on Amazon S3 with CloudFront in front for HTTPS, caching,
and better security. It also covers a simple S3-only website hosting option.

Prerequisites

- AWS CLI configured with permissions to manage S3 and CloudFront
- An S3 bucket (new or existing)
- Optional: ACM certificate in the AWS region used by CloudFront (us-east-1
  for CloudFront)

1) Build the production assets

```bash
cd mongo-explorer
npm install
npm run build
# build output is in `dist/`
```

2) Upload assets to S3

Simple `aws s3 sync` (public objects):

```bash
aws s3 sync dist/ s3://YOUR-BUCKET-NAME --delete --acl public-read
```

Better (recommended): keep bucket private and serve via CloudFront (no `--acl public-read`).

Set sensible `Cache-Control` for long-lived assets (JS/CSS) and shorter for
`index.html` so deploys propagate quickly. Example using `s3 cp` to set headers:

```bash
# set long cache for assets
aws s3 cp dist/static/js s3://YOUR-BUCKET-NAME/static/js --recursive --content-type "application/javascript" --cache-control "public, max-age=31536000, immutable"
# set short cache for index.html
aws s3 cp dist/index.html s3://YOUR-BUCKET-NAME/index.html --content-type "text/html" --cache-control "public, max-age=60"
```

3) SPA routing (important)

If using S3 website hosting without CloudFront, set the bucket website config to
use `index.html` as both the index and error document so client-side routes
work:

```bash
aws s3 website s3://YOUR-BUCKET-NAME --index-document index.html --error-document index.html
```

When using CloudFront, create a behavior that forwards viewer requests to the
origin and configure the distribution's custom error responses to return
`/index.html` with HTTP 200 for 403/404 errors (this preserves SEO/SPA
navigation). CloudFront is recommended for HTTPS and performance.

4) CloudFront: basic steps (console or CLI)

- Create a distribution with your S3 bucket as origin. Prefer Origin Access
  (OAC) so the bucket can remain private.
- Configure the default behavior to allow GET/HEAD and cache based on headers
  you need (usually nothing special).
- Add custom error responses: for 403 and 404 set the response page path to
  `/index.html`, response code `200` and TTL `0` (or low) so changes are seen
  faster.
- Attach an ACM certificate for your custom domain and enable HTTPS.

Example invalidation after deploy (CloudFront distribution id = D1234ABC):

```bash
aws cloudfront create-invalidation --distribution-id D1234ABC --paths "/*"
```

5) CORS and hosting schema JSON files

- If the app fetches schema JSON hosted on the same S3 bucket, ensure the
  objects are readable and the bucket CORS allows `GET` from your domain:

```xml
<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>*</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
  </CORSRule>
</CORSConfiguration>
```

Replace `*` with your domain for better security.

6) Bucket policy (public-read example)

If you choose public S3 hosting (not recommended for production), a minimal
bucket policy is:

```json
{
  "Version":"2012-10-17",
  "Statement":[
    {
      "Sid":"PublicReadGetObject",
      "Effect":"Allow",
      "Principal": "*",
      "Action":["s3:GetObject"],
      "Resource":["arn:aws:s3:::YOUR-BUCKET-NAME/*"]
    }
  ]
}
```

7) Tips & notes

- Use CloudFront with OAC for production for security and HTTPS rather than
  making the bucket public.
- Keep `index.html` cache short so new deploys become visible quickly.
- Large JS chunks: if your build produces very large bundles (>500KB),
  consider code-splitting or lazy-loading heavy pages to improve first load.
- If you serve schema JSON from S3 and want controlled access, use signed
  CloudFront URLs or presigned S3 URLs.

8) Example quick workflow (build → sync → invalidate)

```bash
cd mongo-explorer
npm run build
aws s3 sync dist/ s3://YOUR-BUCKET-NAME --delete
aws cloudfront create-invalidation --distribution-id YOUR_DISTRIBUTION_ID --paths "/*"
```

9) Troubleshooting

- If routes 404 on refresh, ensure CloudFront custom error responses return
  `/index.html` with 200, or S3 Website error document is set to `index.html`.
- If objects are not loading due to 403, check bucket/object permissions or
  CloudFront OAC origin access settings.

If you want, I can add a small `deploy.sh` script to `mongo-explorer/` that
wraps the `npm run build`, `aws s3 sync`, and CloudFront invalidation steps
and reads config from environment variables.
