/* Pinned on-demand neural assets. Sizes and SHA-256s come from upstream bytes and Hugging Face LFS.
   Kept separate from offline-assets.js: downloading the app never downloads these files. */
(() => {
const assets = {
  "runtime": {
    "url": "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.wasm.min.mjs",
    "bytes": 50126,
    "sha256": "219e6a1fc8a9938268d18efca3c91d310bd2f4a59bbd13744df5b2b7fc6cee3b"
  },
  "glue": {
    "url": "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort-wasm-simd-threaded.mjs",
    "bytes": 24381,
    "sha256": "e13f7f94fc51b4ca72b12faeb1ee95f4ace6dfbc8939bc718aabdc0a27c4299b"
  },
  "wasm": {
    "url": "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort-wasm-simd-threaded.wasm",
    "bytes": 14239897,
    "sha256": "3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2"
  },
  "dictionary": {
    "url": "https://raw.githubusercontent.com/cmusphinx/cmudict/74790861f652b15e4ac49015a90074ad62a27690/cmudict.dict",
    "bytes": 3618488,
    "sha256": "81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22"
  },
  "kittenModel": {
    "url": "https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8/resolve/84781d74e29ee25217551556398b42f80593a813/kitten_tts_nano_v0_8.onnx",
    "bytes": 24369971,
    "sha256": "f7b0afcbee92870b32b8e0276d855b954dc25470c9f051b376ac7eee537c76fc"
  },
  "kittenVoices": {
    "url": "https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8/resolve/84781d74e29ee25217551556398b42f80593a813/voices.npz",
    "bytes": 3278902,
    "sha256": "8aa7cee235abb0739cb51e6559685f65a4dacd95568833d05699b1633f519b3f"
  },
  "kittenConfig": {
    "url": "https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8/resolve/84781d74e29ee25217551556398b42f80593a813/config.json",
    "bytes": 688,
    "sha256": "b66006ccbeccd4de5fc3c9272059c47f5725df7215fd889785c03602652fab64"
  },
  "kokoroModel": {
    "url": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/onnx/model_q8f16.onnx",
    "bytes": 86033585,
    "sha256": "04c658aec1b6008857c2ad10f8c589d4180d0ec427e7e6118ceb487e215c3cd0"
  },
  "kokoroTokenizer": {
    "url": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/tokenizer.json",
    "bytes": 3497,
    "sha256": "77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34"
  },
  "kokoro:af": {
    "url": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af.bin",
    "bytes": 524288,
    "sha256": "a4f11d9d055a12bfa0db2668a3e4f0ef8fd1f1ccca69494479718e44dbf9e41a"
  },
  "kokoro:af_alloy": {
    "url": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_alloy.bin",
    "bytes": 522240,
    "sha256": "c4a6b876047fd7fb472edf4ebd63cfac7c3b958a7cae7c106e8f038ca6308c45"
  },
  "kokoro:af_aoede": {
    "url": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_aoede.bin",
    "bytes": 522240,
    "sha256": "4a004c33430762e2461eedb2013fad808ef4ab3121f5300f554476caf58d8361"
  },
  "kokoro:af_bella": {
    "url": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_bella.bin",
    "bytes": 522240,
    "sha256": "f69d836209b78eb8c66e75e3cda491e26ea838a3674257e9d4e5703cbaf55c8b"
  },
  "kokoro:af_heart": {
    "url": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_heart.bin",
    "bytes": 522240,
    "sha256": "d583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b"
  },
  "kokoro:af_jessica": {
    "url": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_jessica.bin",
    "bytes": 522240,
    "sha256": "a240a5e3c15b43563d6e923bdca8ef5613a23471d9b77653694012435df23bd8"
  },
  "kokoro:af_kore": {
    "url": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_kore.bin",
    "bytes": 522240,
    "sha256": "9be5221b6a941c04b561959b8ff0b06e809444dcc4ab7e75a7b23606f691819e"
  },
  "kokoro:af_nicole": {
    "url": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_nicole.bin",
    "bytes": 522240,
    "sha256": "cd2191ab31b914ed7b318416b0e4440fdf392ddad9106a060819aa600a64f59a"
  },
  "kokoro:af_nova": {
    "url": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_nova.bin",
    "bytes": 522240,
    "sha256": "18778272caa0d0eebaea251c35fd635f038434f9eee5e691d02a174bd328414f"
  },
  "kokoro:af_river": {
    "url": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_river.bin",
    "bytes": 522240,
    "sha256": "00a2bcf82b1d86e8f19902ede58c65ccf6c0e43b44b7d74fad54e5d8933c9c30"
  },
  "kokoro:af_sarah": {
    "url": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_sarah.bin",
    "bytes": 522240,
    "sha256": "4409fbc125afabacc615d94db5398d847006a737b0247d6892b7a9a0007a2f0a"
  },
  "kokoro:af_sky": {
    "url": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_sky.bin",
    "bytes": 522240,
    "sha256": "4435255c9744f3f31659e0d714ab7689bf65d9e77ec1cce060f083912614f0b9"
  },
  "kokoro:am_adam": {
    "url": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/am_adam.bin",
    "bytes": 522240,
    "sha256": "162b035ed91cfc48b6046982184c645f72edcdd1b82843347f605d7bf7b15716"
  },
  "kokoro:am_echo": {
    "url": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/am_echo.bin",
    "bytes": 522240,
    "sha256": "3968b92c3c4cd1c4416dbded36c13eaa388a90d5788d02a13e4d781f5f8cf3c3"
  },
  "kokoro:am_eric": {
    "url": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/am_eric.bin",
    "bytes": 522240,
    "sha256": "e8b5be17edd1e3636901ce7598baafe2dc8dd8ff707a0c23bf9e461add7e2832"
  },
  "kokoro:am_fenrir": {
    "url": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/am_fenrir.bin",
    "bytes": 522240,
    "sha256": "c27989f741f7ee34d273a39d8a595cc0837d35f5ced9a29b7cc162614616df43"
  },
  "kokoro:am_liam": {
    "url": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/am_liam.bin",
    "bytes": 522240,
    "sha256": "52403be32fd047c6a44517cb0bcd6b134f2a18baa73e70ef41651e0eab921ade"
  },
  "kokoro:am_michael": {
    "url": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/am_michael.bin",
    "bytes": 522240,
    "sha256": "1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1"
  },
  "kokoro:am_onyx": {
    "url": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/am_onyx.bin",
    "bytes": 522240,
    "sha256": "da5d135b424164916d75a68ffb4c2abce3d7d5ccc82dd1ee6cf447ce286145e6"
  },
  "kokoro:am_puck": {
    "url": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/am_puck.bin",
    "bytes": 522240,
    "sha256": "fcf73c989033e9233e0b98713eca600c8c74dcc1614b37009d5450ff4a2274a0"
  },
  "kokoro:am_santa": {
    "url": "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/am_santa.bin",
    "bytes": 522240,
    "sha256": "61150cf726ab6c5ed7a99f90a304f91f5a72c00c592e89ec94e5df11c319227a"
  }
};
const kitten = ['Bella', 'Jasper', 'Luna', 'Bruno', 'Rosie', 'Hugo', 'Kiki', 'Leo'];
const voices = [...kitten.map(name => 'kitten:' + name), ...Object.keys(assets).filter(key => key.startsWith('kokoro:'))];
function files(name) {
  if (!voices.includes(name)) throw new Error('Unknown neural voice.');
  return ['runtime', 'glue', 'wasm', 'dictionary', ...(name.startsWith('kitten:') ? ['kittenModel', 'kittenVoices', 'kittenConfig'] : ['kokoroModel', 'kokoroTokenizer', name])].map(key => assets[key]);
}
const api = { assets, voices, files, CACHE: 'audioonline-voices-v1',
  prefixes: ["https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/", "https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8/resolve/84781d74e29ee25217551556398b42f80593a813/", "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/", "https://raw.githubusercontent.com/cmusphinx/cmudict/74790861f652b15e4ac49015a90074ad62a27690/", "https://us.aws.cdn.hf.co/"] };
if (typeof module !== 'undefined') module.exports = api; else globalThis.AudioNeuralManifest = api;
})();
