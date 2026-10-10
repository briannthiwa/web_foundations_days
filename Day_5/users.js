// Array to store fetched users locally for client-side filtering
let loadedUsers = [];

// DOM Element Selectors
const loadBtn = document.getElementById('load-users');
const filterInput = document.getElementById('filter-input');
const statusMsg = document.getElementById('status');
const usersList = document.getElementById('users-list');

/**
 * Fetches users from the API, handles error statuses, and manages UI loading states.
 */
async function loadUsers() {
    // 1. Update UI to Loading state
    statusMsg.textContent = "Loading...";
    loadBtn.disabled = true;
    usersList.innerHTML = "";
    
    // To test the error path as requested, modify this string to an invalid endpoint
    const url = "https://jsonplaceholder.typicode.com/users"; 

    try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP Error! Status: ${response.status}`);
        }

        loadedUsers = await response.json();
        
        // 2. Clear loading message and render users
        statusMsg.textContent = "Users loaded successfully!";
        renderUsers(loadedUsers);

    } catch (error) {
        // 3. Handle errors (network issues or broken URLs)
        statusMsg.textContent = `Error loading users: ${error.message}`;
        loadedUsers = []; // Reset local memory
    } finally {
        // 4. Re-enable button regardless of success or failure
        loadBtn.disabled = false;
    }
}

/**
 * Dynamically constructs and appends list items based on the provided users array.
 * @param {Array} list - Array of user objects to display
 */
function renderUsers(list) {
    // Clear list before drawing
    usersList.innerHTML = "";

    // Show empty state message if no entries match filter criteria
    if (list.length === 0) {
        const emptyMessage = document.createElement('li');
        emptyMessage.textContent = "No users match your filter.";
        usersList.appendChild(emptyMessage);
        return;
    }

    // Populate user elements utilizing secure textContent assignment
    list.forEach(user => {
        const li = document.createElement('li');
        li.style.marginBottom = "10px";
        
        const nameEl = document.createElement('strong');
        nameEl.textContent = user.name;
        
        const detailsEl = document.createElement('span');
        detailsEl.textContent = ` — Email: ${user.email} | City: ${user.address.city} | Company: ${user.company.name}`;
        
        li.appendChild(nameEl);
        li.appendChild(detailsEl);
        usersList.appendChild(li);
    });
}

// Event Listeners
loadBtn.addEventListener('click', loadUsers);

filterInput.addEventListener('input', (event) => {
    const query = event.target.value.toLowerCase();
    
    // Perform a non-case-sensitive client-side filter
    const filteredUsers = loadedUsers.filter(user => 
        user.name.toLowerCase().includes(query)
    );
    
    renderUsers(filteredUsers);
});
