'use strict';

const http = require('node:http');
const { MAX_FORM } = require('./app');

function createHttpServer(app, { trustProxy = false } = {}) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    let size = 0, dead = false;
    const limit = req.method === 'POST' ? MAX_FORM + 10_000 : 10_000;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit && !dead) {
        dead = true;
        res.writeHead(413, { 'Content-Type': 'text/plain', Connection: 'close' });
        res.end('That is too big.');
        req.destroy();
        return;
      }
      if (!dead) chunks.push(chunk);
    });
    req.on('end', () => {
      if (dead) return;
      const forwarded = trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',').pop().trim() : '';
      let out;
      try {
        out = app.handle({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks), ip: forwarded || req.socket.remoteAddress || 'unknown' });
      } catch (error) {
        console.error(error);
        out = { status: 500, headers: { 'Content-Type': 'text/plain' }, body: Buffer.from('Something went wrong.') };
      }
      res.writeHead(out.status, { ...out.headers, 'Content-Length': out.body.length });
      res.end(req.method === 'HEAD' ? undefined : out.body);
    });
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return server;
}

module.exports = { createHttpServer };
