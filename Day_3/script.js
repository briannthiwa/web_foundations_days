// ===== Starting notes =====
let notes = [
  { id: 1, text: "Buy milk and bread", category: "personal" },
  { id: 2, text: "Finish the Day 3 assignment", category: "study" },
  { id: 3, text: "Email the project report to Grace", category: "work" },
  { id: 4, text: "Revise JavaScript arrays", category: "study" },
  { id: 5, text: "Call mum", category: "personal" },
];

const VALID_CATEGORIES = ["personal", "work", "study"];

// Lowercase, trim, and collapse repeated whitespace.
function normalize(text) {
  return String(text).trim().replace(/\s+/g, " ").toLowerCase();
}

// ===== 1. searchNotes =====
function searchNotes(word) {
  const target = String(word).toLowerCase();
  return notes.filter((note) => note.text.toLowerCase().includes(target));
}

// ===== 2. longestNote =====
function longestNote() {
  if (notes.length === 0) return null;
  return notes.reduce((longest, note) =>
    note.text.length > longest.text.length ? note : longest
  );
}

// ===== 3. countByCategory =====
function countByCategory() {
  const raw = {};
  for (const note of notes) {
    raw[note.category] = (raw[note.category] || 0) + 1;
  }
  // Keep a predictable order: personal, work, study (then anything else).
  const counts = {};
  for (const cat of VALID_CATEGORIES) {
    if (raw[cat]) counts[cat] = raw[cat];
  }
  for (const cat of Object.keys(raw)) {
    if (!(cat in counts)) counts[cat] = raw[cat];
  }
  return counts;
}

// ===== 4. getSummary =====
function getSummary() {
  const counts = countByCategory();
  const parts = Object.entries(counts).map(([cat, n]) => `${n} ${cat}`);
  const total = notes.length;
  const label = total === 1 ? "note" : "notes";
  return parts.length > 0
    ? `${total} ${label}: ${parts.join(", ")}.`
    : `${total} ${label}.`;
}

// ===== 5. isDuplicate =====
function isDuplicate(text) {
  const target = normalize(text);
  return notes.some((note) => normalize(note.text) === target);
}

// ===== 6. addNote =====
function addNote(text, category) {
  if (typeof text !== "string") {
    console.log("Not added: text must be a string.");
    return false;
  }
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (cleaned.length < 1 || cleaned.length > 200) {
    console.log(`Not added: text must be 1-200 characters (got ${cleaned.length}).`);
    return false;
  }
  if (isDuplicate(cleaned)) {
    console.log(`Not added: "${cleaned}" already exists.`);
    return false;
  }
  if (!VALID_CATEGORIES.includes(category)) {
    console.log(`Not added: category "${category}" must be one of ${VALID_CATEGORIES.join(", ")}.`);
    return false;
  }
  const nextId = notes.length > 0 ? Math.max(...notes.map((n) => n.id)) + 1 : 1;
  notes.push({ id: nextId, text: cleaned, category });
  return true;
}

// ===== Tests =====
console.log("--- searchNotes ---");
console.log(searchNotes("THE"));          // expect 2 notes: ids 2 and 3
console.log(searchNotes("javascript"));   // expect 1 note: id 4
console.log(searchNotes("zzz"));          // expect []

console.log("--- longestNote ---");
console.log(longestNote());               // expect id 3 ("Email the project report to Grace")

console.log("--- countByCategory ---");
console.log(countByCategory());           // expect { personal: 2, work: 1, study: 2 }

console.log("--- getSummary ---");
console.log(getSummary());                // expect "5 notes: 2 personal, 1 work, 2 study."

console.log("--- isDuplicate ---");
console.log(isDuplicate("call mum"));                  // expect true
console.log(isDuplicate("  BUY   milk and  BREAD ")); // expect true (case + extra spaces)
console.log(isDuplicate("Something brand new"));       // expect false

console.log("--- addNote ---");
console.log(addNote("Plan weekend hike", "personal")); // expect true
console.log(addNote("plan  weekend  HIKE", "personal")); // expect false (duplicate)
console.log(addNote("", "work"));                      // expect false (too short)
console.log(addNote("x".repeat(201), "work"));         // expect false (too long)
console.log(addNote("Valid text", "hobby"));           // expect false (bad category)
console.log(addNote("x".repeat(200), "study"));        // expect true (exactly 200)

console.log("--- after adding ---");
console.log(getSummary());                // expect "7 notes: 3 personal, 1 work, 3 study."
console.log(countByCategory());           // expect { personal: 3, work: 1, study: 3 }

// Empty-list edge case
const backup = notes.splice(0, notes.length);
console.log(longestNote());               // expect null
console.log(getSummary());                // expect "0 notes."
notes.push(...backup);
