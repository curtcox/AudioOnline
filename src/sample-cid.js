/* Pure CID operations for the consumer's classic execution adapter; document codecs stay in the editor. */
(() => {
const core=typeof module!=='undefined'?{...require('../vendor/fragment-kit-v0.4.3/src/core/cid.js'),...require('../vendor/fragment-kit-v0.4.3/src/core/bytes.js')}:globalThis.FragmentKitSampleCid;
const HashBinDocuments={isCID:core.isCID,cidLength:core.cidLength,decode64:core.decode64,MAX_SAMPLE_BYTES:16*1024*1024};
if(typeof module!=='undefined')module.exports={HashBinDocuments};else globalThis.HashBinDocuments=HashBinDocuments;
})();
