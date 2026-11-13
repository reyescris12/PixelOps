import { execSync } from 'node:child_process';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BUFFER_ACCESS_TOKEN = process.env.BUFFER_ACCESS_TOKEN;
const BUFFER_CHANNEL_ID = process.env.BUFFER_CHANNEL_ID;
const BUFFER_MODE = process.env.BUFFER_MODE || 'addToQueue';

if (!GEMINI_API_KEY || !BUFFER_ACCESS_TOKEN || !BUFFER_CHANNEL_ID) {
  console.error('Missing required environment secrets (GEMINI_API_KEY, BUFFER_ACCESS_TOKEN, BUFFER_CHANNEL_ID). Skipping dispatch.');
  process.exit(0);
}

async function run() {
  // 1. Get the last commit message and list of changed files
  const commitMsg = execSync('git log -1 --pretty=%B').toString().trim();
  const changedFiles = execSync(
    'git diff-tree --no-commit-id --name-only -r -m --first-parent --root HEAD'
  )
    .toString()
    .trim();

  if (commitMsg.includes('[skip-post]')) {
    console.log('Commit skipped due to [skip-post] tag.');
    return;
  }

  // 2. Prompt Gemini Flash to write a concise #BuildInPublic Dev Log post
  const prompt = `You are a social media copywriter for PixelOps (pixelops.app), an edge-native, local-first intelligence center with a 16-bit safehouse UI.
Write a single, authentic "Build in Public" Dev Log post summarizing this latest git commit.
Commit Message: "${commitMsg}"
Changed Files:
${changedFiles || '(none)'}

Rules:
- Max 220 characters total.
- Punchy, technical, and developer-friendly.
- Focus on the feature impact (speed, OSINT telemetry, local-first, agents).
- End with #BuildInPublic #LocalFirst #PixelOps
- Return ONLY the exact post text, no quotes or markdown.`;

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 512,
          temperature: 0.7,
        },
      }),
    }
  );

  const geminiData = await geminiRes.json();
  if (!geminiRes.ok) {
    console.error('Gemini API error:', JSON.stringify(geminiData));
    process.exit(1);
  }

  const postText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text
    ?.trim()
    .replace(/^["']|["']$/g, '');

  if (!postText) {
    console.error('Failed to generate post text from Gemini:', JSON.stringify(geminiData));
    process.exit(1);
  }

  console.log('Generated Post:\n', postText);

  // 3. Dispatch to Buffer GraphQL API (https://api.buffer.com)
  const graphqlMutation = {
    query: `mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess {
          post {
            id
            status
            dueAt
          }
        }
        ... on MutationError {
          message
        }
      }
    }`,
    variables: {
      input: {
        channelId: BUFFER_CHANNEL_ID,
        text: postText,
        schedulingType: 'automatic',
        mode: BUFFER_MODE,
      },
    },
  };

  const bufferRes = await fetch('https://api.buffer.com', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${BUFFER_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(graphqlMutation),
  });

  const bufferData = await bufferRes.json();
  console.log('Buffer API response:', JSON.stringify(bufferData));

  if (!bufferRes.ok || bufferData.errors?.length || bufferData.data?.createPost?.message) {
    console.error('Buffer API returned an error.');
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Execution error:', err);
  process.exit(1);
});
