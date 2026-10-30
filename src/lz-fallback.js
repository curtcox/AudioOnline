/* Loads the identical vendored copy when the CDN is blocked. A file, not inline, for the Content-Security-Policy. */
if (!globalThis.LZString) document.write('<script src="vendor/lz-string.min.js"><\/script>');
