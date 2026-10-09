// Element Selection
const noteText = document.getElementById('note-text');
const charCount = document.getElementById('char-count');
const wordCount = document.getElementById('word-count');
const clearBtn = document.getElementById('clear-btn');
const themeToggle = document.getElementById('theme-toggle');

// Helper to Update Counters and Classes
function updateCounts() {
    const text = noteText.value;
    const totalChars = text.length;

    // Word count tracking (regex eliminates trailing/leading white space artifacts)
    const totalWords = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;

    charCount.textContent = `${totalChars} / 200 characters`;
    wordCount.textContent = `${totalWords} word${totalWords === 1 ? '' : 's'}`;

    // Reset indicator classes
    charCount.className = '';

    if (totalChars > 200) {
        charCount.classList.add('over');
    } else if (totalChars > 180) {
        charCount.classList.add('warning');
    }
}

// Helper to Clear Everything
function clearAll() {
    noteText.value = '';
    localStorage.removeItem('noteDraft');
    updateCounts();
}

// Event Listeners
noteText.addEventListener('input', () => {
    updateCounts();
    localStorage.setItem('noteDraft', noteText.value);
});

noteText.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        clearAll();
    }
});

clearBtn.addEventListener('click', clearAll);

themeToggle.addEventListener('click', () => {
    const isDark = document.body.classList.toggle('dark');
    themeToggle.textContent = isDark ? 'Light mode' : 'Dark mode';
    localStorage.setItem('themeChoice', isDark ? 'dark' : 'light');
});

// Initialization on DOM Load
window.addEventListener('DOMContentLoaded', () => {
    // Restore Draft
    const savedDraft = localStorage.getItem('noteDraft');
    if (savedDraft !== null) {
        noteText.value = savedDraft;
    }

    // Restore Theme
    const savedTheme = localStorage.getItem('themeChoice');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark');
        themeToggle.textContent = 'Light mode';
    } else {
        document.body.classList.remove('dark');
        themeToggle.textContent = 'Dark mode';
    }

    // Initialize counts on initial rendering load
    updateCounts();
});
