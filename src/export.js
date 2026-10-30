const AudioExport = {
  download(content, name, type = 'text/plain;charset=utf-8') {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },
  async png(svg, scale = 2) {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('Could not rasterize the SVG. Download SVG instead.')); image.src = url; });
      const canvas = document.createElement('canvas'); canvas.width = image.width * scale; canvas.height = image.height * scale;
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG export failed.')), 'image/png'));
    } finally { URL.revokeObjectURL(url); }
  }
};
if (typeof module !== 'undefined') module.exports = AudioExport;
else globalThis.AudioExport = AudioExport;
