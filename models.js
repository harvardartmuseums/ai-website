const { models } = require("./public/vocabularies/stats");

module.exports = {
  // Anthropic
  'us.anthropic.claude-3-5-sonnet-20241022-v2:0':     { name: 'Claude 3.5 Sonnet',    released: '2024-10-22', openWeight: false },
  'global.anthropic.claude-3-5-sonnet-20241022-v2:0': { name: 'Claude 3.5 Sonnet',    released: '2024-10-22', openWeight: false },
  'global.anthropic.claude-sonnet-4-5-20250929-v1:0': { name: 'Claude Sonnet 4.5',    released: '2025-09-29', openWeight: false },
  'global.anthropic.claude-sonnet-4-20250514-v1:0':   { name: 'Claude Sonnet 4',      released: '2025-05-14', openWeight: false },
  'us.anthropic.claude-3-7-sonnet-20250219-v1:0':     { name: 'Claude 3.7 Sonnet',    released: '2025-02-19', openWeight: false },
  'us.anthropic.claude-opus-4-5-20251101-v1:0':       { name: 'Claude Opus 4.5',      released: '2025-11-01', openWeight: false },
  'us.anthropic.claude-haiku-4-5-20251001-v1:0':      { name: 'Claude Haiku 4.5',     released: '2025-10-01', openWeight: false },
  'us.anthropic.claude-3-opus-20240229-v1:0':         { name: 'Claude 3 Opus',        released: '2024-02-29', openWeight: false },
  'anthropic.claude-3-opus-20240229-v1:0':            { name: 'Claude 3 Opus',        released: '2024-02-29', openWeight: false },
  'anthropic.claude-3-haiku-20240307-v1:0':           { name: 'Claude 3 Haiku',       released: '2024-03-07', openWeight: false },
  'claude-3-haiku-20240307':                          { name: 'Claude 3 Haiku',       released: '2024-03-07', openWeight: false },
  'claude-3-haiku-48k-20240307':                      { name: 'Claude 3 Haiku (48k)', released: '2024-03-07', openWeight: false },
  'claude-3-5-sonnet-20241022':                       { name: 'Claude 3.5 Sonnet',    released: '2024-10-22', openWeight: false },
  // OpenAI
  'gpt-4':                                           { name: 'GPT-4',                 released: '2023-04-13', openWeight: false },
  'gpt-4o-2024-05-13':                               { name: 'GPT-4o (May 2024)',     released: '2024-05-13', openWeight: false },
  'gpt-4o-2024-08-06':                               { name: 'GPT-4o (Aug 2024)',     released: '2024-08-06', openWeight: false },
  'gpt-4o-2024-11-20':                               { name: 'GPT-4o (Nov 2024)',     released: '2024-11-20', openWeight: false },
  'gpt-4.1-mini-2025-04-14':                         { name: 'GPT-4.1 Mini',          released: '2025-04-14', openWeight: false },
  'gpt-5-nano-2025-08-07':                           { name: 'GPT-5 Nano',            released: '2025-08-07', openWeight: false },
  // Google
  // https://ai.google.dev/gemini-api/docs/changelog
  // Dates for GA releases, not previews or early access. GA releases are when the models are widely available and considered stable.
  'gemini-2.0-flash':                                { name: 'Gemini 2.0 Flash',      released: '2024-12-11', openWeight: false },
  'gemini-2.0-flash-lite':                           { name: 'Gemini 2.0 Flash Lite', released: '2025-02-25', openWeight: false },
  'gemini-2.5-flash':                                { name: 'Gemini 2.5 Flash',      released: '2025-06-17', openWeight: false },
  'gemini-2.5-flash-lite':                           { name: 'Gemini 2.5 Flash Lite', released: '2025-07-22', openWeight: false },
  // Meta
  'us.meta.llama3-2-11b-instruct-v1:0':              { name: 'Llama 3.2 11B',         released: '2024-09-25', openWeight: true  },
  'us.meta.llama3-2-90b-instruct-v1:0':              { name: 'Llama 3.2 90B',         released: '2024-09-25', openWeight: true  },
  'us.meta.llama4-scout-17b-instruct-v1:0':          { name: 'Llama 4 Scout 17B',     released: '2025-04-05', openWeight: true  },
  'us.meta.llama4-maverick-17b-instruct-v1:0':       { name: 'Llama 4 Maverick 17B',  released: '2025-04-05', openWeight: true  },
  // Amazon
  'amazon.nova-lite-v1:0':                           { name: 'Nova Lite',             released: '2024-12-05', openWeight: false, modelCardUrl: 'https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-lite.html' },
  'amazon.nova-pro-v1:0':                            { name: 'Nova Pro',              released: '2024-12-05', openWeight: false, modelCardUrl: 'https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-pro.html' },
  'us.amazon.nova-2-lite-v1:0':                      { name: 'Nova 2 Lite',           released: '2025-12-02', openWeight: false, modelCardUrl: 'https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html'},
  // Mistral
  'us.mistral.pixtral-large-2502-v1:0':              { name: 'Pixtral Large',         released: '2025-02-01', openWeight: true  },
  'mistral.magistral-small-2509':                    { name: 'Magistral Small',       released: '2025-09-18', openWeight: true, modelCardUrl: 'https://docs.mistral.ai/models/model-cards/magistral-small-1-2-25-09'  },
  'mistral.ministral-3-14b-instruct':                { name: 'Ministral 14B',         released: '2025-12-02', openWeight: true, modelCardUrl: 'https://docs.mistral.ai/models/model-cards/ministral-3-14b-25-12' },
  'mistral.ministral-3-3b-instruct':                 { name: 'Ministral 3B',          released: '2025-12-02', openWeight: true, modelCardUrl: 'https://docs.mistral.ai/models/model-cards/ministral-3-3b-25-12' },
  'mistral.ministral-3-8b-instruct':                 { name: 'Ministral 8B',          released: '2025-12-02', openWeight: true, modelCardUrl: 'https://docs.mistral.ai/models/model-cards/ministral-3-8b-25-12'  },
  'mistral.mistral-large-3-675b-instruct':           { name: 'Mistral Large 3 675B',  released: '2025-12-02', openWeight: true, modelCardUrl: 'https://docs.mistral.ai/models/model-cards/mistral-large-3-25-12'  },
  // Qwen
  'Qwen/Qwen2.5-VL-7B-Instruct':                    { name: 'Qwen 2.5 VL 7B',         released: null,         openWeight: true  },
  'Qwen/Qwen2.5-VL-72B-Instruct':                   { name: 'Qwen 2.5 VL 72B',        released: null,         openWeight: true  },
  'qwen.qwen3-vl-235b-a22b':                         { name: 'Qwen3 VL 235B',         released: '2025-09-23', openWeight: true, modelCardUrl: 'https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-qwen-qwen3-vl-235b-a22b.html'  },
  // Moonshot
  'moonshotai.kimi-k2.5':                            { name: 'Kimi K2.5',             released: '2026-01-27', openWeight: true, modelCardUrl: 'https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-moonshot-ai-kimi-k2-5.html'  },
  // Writer
  'writer.palmyra-vision-7b':                        { name: 'Palmyra Vision 7B',     released: '2026-03-26', openWeight: false, modelCardUrl: 'https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-writer-palmyra-vision-7b.html' },
  // Clarifai / legacy
  'general-image-detection':                         { name: 'General Image Detection',   released: null,     openWeight: false },
  'general-image-recognition':                       { name: 'General Image Recognition', released: null,     openWeight: false },
  'general-english-image-caption-blip':              { name: 'BLIP Caption',              released: null,     openWeight: true  },
  'general-english-image-caption-blip-2':            { name: 'BLIP-2 Caption',            released: null,     openWeight: true  },
  'general-english-image-caption-clip':              { name: 'CLIP Caption',              released: null,     openWeight: true  },
  '3.0':                                             { name: 'v3.0',                      released: null,     openWeight: false },
  '2021-05-01':                                      { name: 'v2021-05-01',               released: null,     openWeight: false },
};
