// Taste learning — STUB with the final signatures (see ARCHITECTURE.md "Taste learning").
// Implementation in progress; until then it is a no-op so scoreOutfit can wire it safely.
export function learnTaste(events, opts = {}) { return { features: {}, evidence: 0 }; }
export function tasteDelta(items, taste) { return { delta: 0, reasons: [] }; }
export function describeTaste(taste) { return { likes: [], dislikes: [] }; }
