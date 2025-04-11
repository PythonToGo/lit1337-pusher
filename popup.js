const clientId = "Ov23lidbbczriEkuebBd";
const REDIRECT_URL = `https://${chrome.runtime.id}.chromiumapp.org/`;

const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const statusEl = document.getElementById("status");
const repoEl = document.getElementById("repo");
const lastPushEl = document.getElementById("last-push");
const lastLoginEl = document.getElementById("last-login");
const loadingEl = document.getElementById("loading");
const githubBtn = document.getElementById("github-btn");
const repoSelect = document.getElementById("repo-select");

// Function to fetch user's repositories
async function fetchUserRepos(github_token) {
  try {
    console.log('Fetching repositories with token:', github_token ? github_token.substring(0, 5) + '...' : 'missing');
    
    if (!github_token) {
      throw new Error("GitHub token is missing. Please login again.");
    }
    
    // Get the token type from storage
    const tokenType = await new Promise(resolve => {
      chrome.storage.local.get(['token_type'], (result) => {
        resolve(result.token_type || 'standard');
      });
    });
    
    console.log(`Token type: ${tokenType}`);
    
    // Get username from storage - we'll need this for fallback and API calls
    const username = await new Promise(resolve => {
      chrome.storage.local.get(['username'], (result) => {
        resolve(result.username || "");
      });
    });
    
    console.log(`Username: ${username}`);
    
    // Handle temporary tokens
    if (github_token.startsWith('temp_')) {
      console.warn("Using temporary token - will try to fetch repos anyway");
    }
    
    // Try to fetch real repositories first in all cases
    let success = false;
    let repos = [];
    
    // First attempt: Use GitHub API to get user's repositories
    try {
      console.log("Fetching repositories from GitHub API...");
      
      // Try to fetch using username - this doesn't require auth
      const response = await fetch(`https://api.github.com/users/${username}/repos?per_page=100&sort=updated`, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'LIT1337-Chrome-Extension'
        }
      });
      
      if (response.ok) {
        success = true;
        const data = await response.json();
        console.log(`Successfully fetched ${data.length} repositories for user ${username}`);
        repos = data;
      } else {
        console.log(`Public repo fetch failed with status ${response.status}`);
      }
    } catch (error) {
      console.error("Error fetching public repos:", error);
    }
    
    // If that failed, try with token auth
    if (!success && !github_token.startsWith('temp_')) {
      // Method 1: Standard GitHub API token format
      console.log("Trying GitHub API with 'token' prefix...");
      try {
        const response = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
          headers: {
            'Authorization': `token ${github_token}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'LIT1337-Chrome-Extension'
          }
        });
        
        if (response.ok) {
          success = true;
          const data = await response.json();
          console.log(`Successfully fetched ${data.length} repositories with token format`);
          repos = data;
        } else {
          console.log(`Token format failed with status ${response.status}`);
        }
      } catch (error) {
        console.error("Error with token format:", error);
      }
      
      // Method 2: Try Bearer format
      if (!success) {
        console.log("Trying GitHub API with 'Bearer' prefix...");
        try {
          const response = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
            headers: {
              'Authorization': `Bearer ${github_token}`,
              'Accept': 'application/vnd.github.v3+json',
              'User-Agent': 'LIT1337-Chrome-Extension'
            }
          });
          
          if (response.ok) {
            success = true;
            const data = await response.json();
            console.log(`Successfully fetched ${data.length} repositories with Bearer format`);
            repos = data;
          } else {
            console.log(`Bearer format failed with status ${response.status}`);
          }
        } catch (error) {
          console.error("Error with Bearer format:", error);
        }
      }
    }
    
    // If all attempts failed, use fallback demo repositories
    if (!success) {
      console.log("All API attempts failed, using fallback demo repositories");
      repos = [
        { name: "example-repo-1", owner: { login: username || "user" } },
        { name: "example-repo-2", owner: { login: username || "user" } },
        { name: "leetcode-solutions", owner: { login: username || "user" } }
      ];
    }
    
    return Array.isArray(repos) ? repos : [];
  } catch (error) {
    console.error('Error fetching repos:', error);
    throw error; // Rethrow to handle in the caller
  }
}

// Function to populate repository select dropdown
async function populateRepoSelect(github_token) {
  try {
    console.log('Starting repository population...');
    if (!github_token) {
      console.error('Missing GitHub token for repo population');
      repoSelect.innerHTML = '<option value="">Login required</option>';
      statusEl.innerText = "Authentication required. Please login with GitHub.";
      loginBtn.style.display = "inline-block";
      return;
    }
    
    statusEl.innerText = "Loading repositories...";
    repoEl.innerText = "Fetching repositories...";
    
    const repos = await fetchUserRepos(github_token);
    if (repos.length === 0) {
      repoSelect.innerHTML = '<option value="">No repositories found</option>';
      repoEl.innerText = "No repositories found. Please check your GitHub account.";
      return;
    }

    // Sort repositories alphabetically
    repos.sort((a, b) => a.name.localeCompare(b.name));

    repoSelect.innerHTML = '<option value="">Select a repository</option>';
    repos.forEach(repo => {
      const option = document.createElement('option');
      option.value = `${repo.owner.login}/${repo.name}`;
      option.textContent = repo.name;
      repoSelect.appendChild(option);
    });
    console.log(`Populated ${repos.length} repositories`);
    repoEl.innerText = "Please select a repository";
  } catch (error) {
    console.error('Error populating repo select:', error);
    repoSelect.innerHTML = '<option value="">Error loading repositories</option>';
    statusEl.innerText = `Error: ${error.message}`;
    
    // If token related error, show login button
    if (error.message.includes("login") || error.message.includes("token") || error.message.includes("auth")) {
      loginBtn.style.display = "inline-block";
    }
  }
  repoSelect.style.display = 'block';
}

// Listen for auth state changes from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received in popup:', message);
  
  if (message.type === 'auth-state-changed') {
    console.log('Auth state changed:', message);
    
    // Clear login timeout if it exists
    if (window.loginTimeoutId) {
      clearTimeout(window.loginTimeoutId);
      window.loginTimeoutId = null;
    }
    
    loadingEl.classList.remove("show");
    
    if (!message.success) {
      loginBtn.style.display = "inline-block";
      statusEl.className = "badge error";
      
      // Handle server errors specially
      if (message.error && (
          message.error.includes("502") || 
          message.error.includes("503") || 
          message.error.includes("504") ||
          message.error.includes("unavailable")
      )) {
        statusEl.innerHTML = `${message.error}<br><button id="retry-btn" class="small-btn">Retry</button>`;
        
        // Add click handler for retry button
        const retryBtn = document.getElementById("retry-btn");
        if (retryBtn) {
          retryBtn.addEventListener("click", () => {
            // Simulate clicking the login button again
            loginBtn.click();
          });
        }
      } else {
        statusEl.innerText = `Login failed: ${message.error || 'Unknown error'}`;
      }
      return;
    }
    
    // Check if we have the required data before reloading
    chrome.storage.local.get(["jwt", "github_token", "username"], 
      ({ jwt, github_token, username }) => {
        console.log("Storage check after login:", {
          jwt: jwt ? "exists" : "missing",
          github_token: github_token ? "exists" : "missing",
          username: username || "missing",
          tokenLength: github_token ? github_token.length : 0
        });
        
        if (jwt && github_token && username) {
          console.log("Login successful, reloading popup");
          location.reload();
        } else {
          console.error("Login completed but missing required data");
          statusEl.className = "badge error";
          statusEl.innerText = "Login incomplete - missing data. Try again.";
          loginBtn.style.display = "inline-block";
        }
    });
  }
});

// initial render: check JWT + check if user exists on server
chrome.storage.local.get(["jwt", "github_token", "username", "last_push", "last_login", "selected_repo", "token_type"], 
  async ({ jwt, github_token, username, last_push, last_login, selected_repo, token_type }) => {
  console.log('Retrieved from storage:', { 
    jwt: jwt ? `${jwt.substring(0, 10)}...` : 'missing',
    github_token: github_token ? `${github_token.substring(0, 10)}...` : 'missing',
    username,
    token_type: token_type || 'unknown',
    last_login: last_login ? new Date(last_login).toLocaleString() : 'missing',
    last_push: last_push ? new Date(last_push).toLocaleString() : 'missing',
    selected_repo: selected_repo || 'none'
  });
  
  loadingEl.classList.remove("show"); // Always hide loading on initial render
  
  if (jwt && github_token && username) {
    try {
      console.log('User is logged in, updating UI...');
      updateUI(username, last_push, last_login, selected_repo);
      
      // Populate repos after updating UI so user sees they're logged in
      await populateRepoSelect(github_token);
      if (selected_repo) {
        repoSelect.value = selected_repo;
        repoEl.innerText = `Connected repo: ${selected_repo}`;
        githubBtn.style.display = "inline-block";
      } else {
        // Display warning if no repository is selected
        repoEl.innerText = "⚠️ Please select a repository to push code";
        repoEl.style.color = "#ff6b00";
        statusEl.innerText = `Welcome, ${username}! Select a repo`;
      }
    } catch (error) {
      console.error('Error during initialization:', error);
      statusEl.className = "badge error";
      statusEl.innerText = `Error: ${error.message}`;
      
      // Only clear storage if there's a token problem, not for other errors
      if (error.message.includes('token') || error.message.includes('auth')) {
        console.log("Clearing storage due to token error");
        chrome.storage.local.clear(() => {
          loginBtn.style.display = "inline-block";
          logoutBtn.style.display = "none";
          githubBtn.style.display = "none";
          lastPushEl.style.display = "none";
          repoSelect.style.display = "none";
        });
      }
    }
  } else {
    // if not logged in 
    console.log('User is not logged in');
    statusEl.innerText = "🔒 Not logged in";
    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
    githubBtn.style.display = "none";
    lastPushEl.style.display = "none";
    repoSelect.style.display = "none";
  }
});

// click login button
loginBtn.addEventListener("click", () => {
  console.log("Login button clicked");
  loginBtn.style.display = "none";
  statusEl.className = "badge";
  statusEl.innerText = "Connecting to GitHub...";
  loadingEl.classList.add("show");
  
  // Set a timeout to prevent infinite loading
  const loginTimeout = setTimeout(() => {
    console.log("Login timeout reached - 30 seconds with no response");
    loadingEl.classList.remove("show");
    loginBtn.style.display = "inline-block";
    statusEl.className = "badge error";
    statusEl.innerText = "Login timed out. Please try again.";
  }, 30000);
  
  // Store the timeout ID so it can be cleared on success
  window.loginTimeoutId = loginTimeout;
  
  // Force clear any existing tokens before login attempt
  chrome.storage.local.remove(["github_token", "token_type"], () => {
    console.log("Cleared existing GitHub token before login");
    chrome.runtime.sendMessage({ action: "login" });
  });
});

// click github button
githubBtn.addEventListener("click", () => {
  chrome.storage.local.get(["selected_repo"], ({ selected_repo }) => {
    if (selected_repo) {
      const repoUrl = `https://github.com/${selected_repo}`;
      chrome.tabs.create({ url: repoUrl });
    } else {
      console.error("No repository selected.");
      statusEl.innerText = "Please select a repository first.";
    }
  });
});

// click logout button
logoutBtn.addEventListener("click", () => {
  console.log("Logout button clicked");
  // Clear all stored data
  chrome.storage.local.clear(() => {
    console.log("Storage cleared for logout");
    // Reset UI
    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
    githubBtn.style.display = "none";
    lastPushEl.style.display = "none";
    repoSelect.style.display = "none";
    repoSelect.innerHTML = '<option value="">Login required</option>';
    repoEl.innerText = "";
    statusEl.innerText = "🔒 Logged out";
    statusEl.className = "badge";
  });
});

// Repository selection change handler
repoSelect.addEventListener('change', (e) => {
  const selectedRepo = e.target.value;
  if (selectedRepo) {
    console.log(`Selected repository: ${selectedRepo}`);
    
    // Store selected repo in Chrome storage
    chrome.storage.local.set({ selected_repo: selectedRepo }, () => {
      console.log(`Repository saved to storage: ${selectedRepo}`);
      
      // Update UI with selected repo
      chrome.storage.local.get(["username", "last_push", "last_login"], 
        ({ username, last_push, last_login }) => {
          updateUI(username, last_push, last_login, selectedRepo);
        });
    });
  } else {
    console.warn("No repository selected");
  }
});

// UI update function
function updateUI(username, last_push, last_login, selected_repo) {
  statusEl.innerText = `Welcome, ${username}!`;
  loginBtn.style.display = "none";
  logoutBtn.style.display = "inline-block";
  repoSelect.style.display = "block";
  
  if (selected_repo) {
    repoEl.innerText = `Connected repo: ${selected_repo}`;
    repoEl.style.color = "#4caf50"; // Green color to indicate success
    githubBtn.style.display = "inline-block";
  } else {
    repoEl.innerText = "Please select a repository";
    githubBtn.style.display = "none";
  }

  if (last_push) {
    lastPushEl.style.display = "inline-block";
    const pushDate = new Date(last_push);
    lastPushEl.innerText = `Last push: ${pushDate.getFullYear()}-${(pushDate.getMonth() + 1).toString().padStart(2, '0')}-${pushDate.getDate().toString().padStart(2, '0')} ${pushDate.getHours().toString().padStart(2, '0')}:${pushDate.getMinutes().toString().padStart(2, '0')}`;
  } else {
    lastPushEl.style.display = "none";
  }

  if (last_login) {
    const loginDate = new Date(last_login);
    lastLoginEl.innerText = `Last login: ${loginDate.getFullYear()}-${(loginDate.getMonth() + 1).toString().padStart(2, '0')}-${loginDate.getDate().toString().padStart(2, '0')} ${loginDate.getHours().toString().padStart(2, '0')}:${loginDate.getMinutes().toString().padStart(2, '0')}`;
  }
}

