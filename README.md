# ForkTrace M0

Append-only JSONL trace recording for observable OpenAI Agents SDK execution events. This milestone intentionally contains no UI, replay, diffing, authentication, or database.

```sh
npm install
npm test
npm run demo
```

The deterministic demo plants a near-name lookup failure between `J. Ahmed` and `J. Ahmad` and records it without correcting or replaying it.
