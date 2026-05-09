/* eslint-disable no-console */
const express = require('express');
const path = require('path');

const port = Number(process.argv[2] || process.env.FRONTEND_PORT || 5188);
const host = process.env.FRONTEND_HOST || '127.0.0.1';

const app = express();
const distDir = path.join(__dirname, '..', 'dist');

app.disable('x-powered-by');

app.use(
  express.static(distDir, {
    index: false,
    etag: true,
    maxAge: '1h',
  }),
);

// SPA fallback (Express v5 does not accept "*" paths)
app.use((_req, res) => res.sendFile(path.join(distDir, 'index.html')));

app.listen(port, host, () => {
  console.log(`Static frontend running on http://${host}:${port}`);
});
