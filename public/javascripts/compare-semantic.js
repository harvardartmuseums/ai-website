
  import { pipeline, cos_sim } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2/dist/transformers.min.js';

  var embedder = null;
  var semanticRequest = 0;

  async function getEmbedder() {
    if (!embedder) {
      embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
    }
    return embedder;
  }

  async function updateSemanticSimilarity(textA, textB) {
    var request = ++semanticRequest;
    try {
      var emb = await getEmbedder();
      var outA = await emb(textA, { pooling: 'mean', normalize: true });
      var outB = await emb(textB, { pooling: 'mean', normalize: true });
      var sim = cos_sim(Array.from(outA.data), Array.from(outB.data));
      if (request !== semanticRequest) return;
      var pct = Math.round(Math.max(0, sim) * 100);
      document.getElementById('semantic-fill').style.width = pct + '%';
      document.getElementById('semantic-label').textContent = pct + '%';
    } catch(e) {
      if (request === semanticRequest) document.getElementById('semantic-label').textContent = 'Unavailable';
    }
  }

  window.__updateSemantic = function(textA, textB) {
    if (!document.getElementById("research-compare").hidden) updateSemanticSimilarity(textA, textB);
  };

if (!document.getElementById("research-compare").hidden && document.getElementById("panel-a")) window.__updateSemantic(document.getElementById("panel-a").innerText, document.getElementById("panel-b").innerText);
