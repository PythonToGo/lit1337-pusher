let isPushing = false;
let cachedJwt = null;

function getLanguageFromEditor() {
  // find language button
  const buttonXPath = '/html/body/div[1]/div[2]/div/div/div[4]/div/div/div[8]/div/div[1]/div[1]/div[1]/button/button';

  const button = document.evaluate(buttonXPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;

  if (button) {
    const lang = (button.innerText || button.textContent).trim().toLowerCase();
    console.log(`[LangDetect] Detected language: ${lang}`);
    return lang;
  }

  console.warn("[LangDetect] Could not detect language from editor.");
  return null;
}
function getExtensionFromLang(lang) {
  const map = {
    python: 'py',
    python3: 'py',
    cpp: 'cpp',
    'c++': 'cpp',
    java: 'java',
    javascript: 'js',
    typescript: 'ts',
    c: 'c',
    csharp: 'cs',
    ruby: 'rb',
    go: 'go',
    rust: 'rs',
    swift: 'swift',
    kotlin: 'kt',
    scala: 'scala',
    php: 'php'
  };
  return map[lang] || 'txt';
}

function getCode() {
  try {
    // Find the editor container
    const editorContainer = document.querySelector('.monaco-editor');
    if (!editorContainer) {
      console.warn("[CodeCopy] Editor container not found");
      return "// No code found";
    }

    // Get all text content at once
    const textContent = editorContainer.querySelector('.view-lines');
    if (!textContent) {
      console.warn("[CodeCopy] Text content not found");
      return "// No code found";
    }

    // Get all lines with their line numbers
    const lineElements = Array.from(textContent.children);
    const codeMap = new Map();

    // First pass: collect all line numbers and their content
    lineElements.forEach(line => {
      const lineNumber = parseInt(line.getAttribute('style').match(/top:\s*(\d+)/)?.[1] || '0') / 20; // 20px is standard line height
      const content = Array.from(line.querySelectorAll('span'))
        .map(span => span.textContent)
        .join('');
      if (content || lineNumber === 0) {
        codeMap.set(lineNumber, content);
      }
    });

    // Convert map to array and sort by line number
    const sortedLines = Array.from(codeMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([_, content]) => content);

    // Join lines and clean up
    let code = sortedLines.join('\n');

    // Basic cleanup
    code = code
      .replace(/\r\n/g, '\n')     // Normalize line endings
      .replace(/\t/g, '    ')     // Convert tabs to spaces
      .trim() + '\n';             // Ensure single trailing newline

    if (!code.trim()) {
      console.warn("[CodeCopy] Extracted code is empty");
      return "// No code found";
    }

    return code;
  } catch (error) {
    console.error("[CodeCopy] Error getting code:", error);
    return "// Error getting code";
  }
}

function getProblemMeta() {
  const urlParts = window.location.pathname.split("/");
  const problemsIndex = urlParts.indexOf("problems");
  
  // Return null if not in problems section
  if (problemsIndex === -1) return null;
  
  // Get the problem slug (it comes right after "problems")
  const slug = urlParts[problemsIndex + 1];
  if (!slug) return null;

  const title = slug
    .split("-")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join("_");

  return { slug, title };
}

function getCsrfToken() {
  try {
    // SameSite 쿠키 정책 대응
    return document.cookie.split('; ')
      .find(row => row.startsWith('csrftoken='))
      ?.split('=')[1] || '';
  } catch (error) {
    console.warn('[Cookie] Failed to get CSRF token:', error);
    return '';
  }
}

function getJwtToken() {
  return new Promise((resolve, reject) => {
    if (cachedJwt) {
      console.log("Using cached JWT token:", cachedJwt ? `${cachedJwt.substring(0, 10)}...` : 'none');
      return resolve(cachedJwt);
    }

    chrome.storage.local.get("jwt", ({ jwt }) => {
      if (jwt) {
        console.log("JWT token from storage:", jwt ? `${jwt.substring(0, 10)}...` : 'none');
        cachedJwt = jwt;
        resolve(jwt);
      } else {
        console.error("JWT token not found in storage");
        reject("JWT not found");
      }
    });
  });
}

async function getProblemNumberFromSlug(slug) {
  const query = {
    operationName: "getQuestionDetail",
    query: `
      query getQuestionDetail($titleSlug: String!) {
        question(titleSlug: $titleSlug) {
          questionFrontendId
        }
      }
    `,
    variables: { titleSlug: slug }
  };

  try {
    const res = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "x-csrftoken": getCsrfToken()
      },
      body: JSON.stringify(query)
    });

    const data = await res.json();
    // console.log("Stats:", data);
    const number = data?.data?.question?.questionFrontendId;
    return number ? number.padStart(4, "0") : null;
  } catch (err) {
    console.error("GraphQL error:", err);
    return null;
  }
}

async function getStatsFromAPI() {
  let jwt;
  try {
    jwt = await getJwtToken(); // 저장된 JWT 불러오기
  } catch (e) {
    console.error("❌ JWT Load Error:", e);
    return;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/stats`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${jwt}`
      }
    });

    const data = await res.json();
    console.log("📊 Stats API Response:", data);
  } catch (err) {
    console.error("❌ Failed to fetch stats:", err);
  }
}

function isAcceptedOnly() {
  const acceptedXPath = '/html/body/div[1]/div[2]/div/div/div[4]/div/div/div[11]/div/div/div/div[2]/div/div[1]/div[1]/div[1]/span';
  const acceptedElem = document.evaluate(acceptedXPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  return acceptedElem && acceptedElem.textContent.trim() === "Accepted";
}

function getSubmissionResult() {
  // Check if we're on a submission page
  const isSubmissionPage = window.location.pathname.includes('/submissions/');
  if (isSubmissionPage) {
    // Try to find the result in the submissions table
    const resultElement = document.querySelector('[class*="status-column"], [class*="status_column"]');
    if (resultElement) {
      const result = resultElement.textContent.trim();
      return result === 'Accepted' ? 'Accepted' : result;
    }
  }

  // Check for immediate result on the problem page
  const resultElement = document.querySelector(
    '[class*="result-status"], [class*="status-text"], [class*="submission-status"], ' +
    '[data-status="success"], [data-status="accepted"]'
  );
  
  if (resultElement) {
    const result = resultElement.textContent.trim();
    return result === 'Accepted' ? 'Accepted' : result;
  }

  return null;
}

// Modified submission monitoring
function monitorSubmissionStatus(pushBtn) {
  let attempt = 0;
  const maxAttempts = 20;
  let lastResult = null;

  // 현재 페이지가 제출 페이지인지 확인
  const isSubmissionPage = window.location.pathname.includes('/submissions/');
  
  // 이미 Accepted 상태인 경우 즉시 처리
  const currentResult = getSubmissionResult();
  if (currentResult === 'Accepted') {
    console.log('[Submit] Found existing Accepted solution');
    pushCodeToGitHub(pushBtn).finally(() => {
      isPushing = false;
    });
    return () => {};
  }

  const interval = setInterval(() => {
    attempt++;
    
    // 결과 확인
    const result = getSubmissionResult();
    console.log(`[Submit] Attempt ${attempt}, Result: ${result}`);

    if (result && result !== lastResult) {
      lastResult = result;
      console.log(`[Submit] New result detected: ${result}`);

      if (result === 'Accepted') {
        clearInterval(interval);
        console.log('[Submit] Solution accepted, proceeding to push');
        pushCodeToGitHub(pushBtn).finally(() => {
          isPushing = false;
        });
      } else if (result.includes('Wrong') || result.includes('Error') || result.includes('Time Limit')) {
        clearInterval(interval);
        pushBtn.innerText = `❌ ${result}`;
        isPushing = false;
      }
    }

    // 타임아웃 처리 개선
    if (attempt >= maxAttempts) {
      clearInterval(interval);
      console.warn('[Submit] Monitoring timed out');
      
      // 제출 페이지에서는 다른 방식으로 결과 확인
      if (isSubmissionPage) {
        const submissionResult = document.querySelector('[class*="status-column"], [class*="status_column"]');
        if (submissionResult && submissionResult.textContent.includes('Accepted')) {
          console.log('[Submit] Found Accepted in submission page');
          pushCodeToGitHub(pushBtn).finally(() => {
            isPushing = false;
          });
          return;
        }
      }
      
      pushBtn.innerText = "❌ Timeout";
      isPushing = false;
    }
  }, 1000); // 1초 간격으로 변경

  return () => clearInterval(interval);
}

// Push 버튼 클릭 핸들러 개선
function handlePushButtonClick() {
  if (isPushing) {
    console.log('[Push] Already pushing, ignoring click');
    return;
  }
  
  isPushing = true;
  console.log('[Push] Starting push process');

  const pushBtn = document.getElementById("leet-github-push");
  const submitButton = Array.from(document.querySelectorAll("button"))
    .find(btn => {
      const text = btn.innerText.trim().toLowerCase();
      return text === "submit" || text.includes("submit solution");
    });

  if (!submitButton || !pushBtn) {
    console.error('[Push] Submit button or push button not found');
    alert("Submit button not found");
    isPushing = false;
    return;
  }

  pushBtn.innerText = "⏳ Submitting...";
  console.log('[Push] Clicking submit button');
  submitButton.click();
  
  // 모니터링 시작 및 클린업 함수 저장
  const cleanup = monitorSubmissionStatus(pushBtn);

  // 페이지 언로드 시 클린업 실행
  window.addEventListener('unload', cleanup);
}

// Add push button
function addPushButton() {
  // Return if button already exists
  if (document.getElementById("leet-github-push")) return;

  // Find the main action buttons container
  const actionButtonsContainer = findActionButtonsContainer();
  if (!actionButtonsContainer) {
    console.warn("[UI] Could not find action buttons container");
    return;
  }

  const pushBtn = document.createElement("button");
  pushBtn.id = "leet-github-push";
  pushBtn.innerText = "🔄 Push";
  pushBtn.style = `
    margin-right: 8px;
    background-color: #24292e;
    color: white;
    padding: 6px 12px;
    border-radius: 5px;
    border: none;
    font-weight: bold;
    cursor: pointer;
    position: relative;
    z-index: 1000;
  `;

  pushBtn.onclick = handlePushButtonClick;
  actionButtonsContainer.insertBefore(pushBtn, actionButtonsContainer.firstChild);
}

// Find the appropriate container for action buttons
function findActionButtonsContainer() {
  // First try to find the standard editor action buttons container
  const standardContainer = document.querySelector('[class*="action-buttons"], [class*="code-area"] div[class*="flex"]');
  if (standardContainer) return standardContainer;

  // If we're on a different page type (editorial/solutions/submissions)
  const editorArea = document.querySelector('.monaco-editor');
  if (!editorArea) return null;

  // Create a new container if needed
  const existingContainer = editorArea.parentElement.querySelector('.custom-action-buttons');
  if (existingContainer) return existingContainer;

  const newContainer = document.createElement('div');
  newContainer.className = 'custom-action-buttons';
  newContainer.style = `
    display: flex;
    justify-content: flex-start;
    align-items: center;
    padding: 8px;
    background: transparent;
    position: absolute;
    top: 0;
    right: 0;
    z-index: 1000;
  `;

  editorArea.parentElement.style.position = 'relative';
  editorArea.parentElement.insertBefore(newContainer, editorArea);
  return newContainer;
}

// Modify monitorSubmitButton to reset button state after manual submission
function monitorSubmitButton() {
  const pushBtn = document.getElementById("leet-github-push");
  if (!pushBtn) return;

  const observer = new MutationObserver((mutations) => {
    // Only update button state if not in pushing process
    if (!isPushing) {
      const currentText = pushBtn.innerText;
      // Reset button only if it was in an error state (starts with ❌)
      if (currentText.startsWith("❌")) {
        pushBtn.innerText = "🔄 Push";
      }
    }
  });

  // Monitor result container
  const resultContainer = document.querySelector('.view-line')?.parentElement;
  if (resultContainer) {
    observer.observe(resultContainer, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }
}

async function pushCodeToGitHub(pushBtn) {
  // 이미 Accepted인지 먼저 확인
  if (!isAcceptedOnly()) {
    pushBtn.innerText = "❌ Not Accepted";
    return;
  }

  const meta = getProblemMeta();
  if (!meta?.slug || !meta?.title) {
    pushBtn.innerText = "❌ Error";
    return;
  }

  const slug = meta.slug;
  const title = meta.title;

  const lang = getLanguageFromEditor();
  const ext = getExtensionFromLang(lang || 'txt');
  const code = getCode();

  if (!code || code.trim().startsWith("// No code")) {
    pushBtn.innerText = "❌ Empty";
    return;
  }

  const problemNumber = await getProblemNumberFromSlug(slug);
  const filename = `${problemNumber}_${title}.${ext}`;

  let jwt;
  try {
    jwt = await getJwtToken();
    if (!jwt || jwt.trim() === '') {
      pushBtn.innerText = "❌ Invalid JWT";
      console.error("JWT token is empty or invalid");
      return;
    }
  } catch (e) {
    pushBtn.innerText = "❌ No Login";
    console.error("JWT token error:", e);
    return;
  }

  // Get selected repository from storage
  const selectedRepo = await new Promise(resolve => {
    chrome.storage.local.get(['selected_repo'], (result) => {
      resolve(result.selected_repo || "");
    });
  });
  
  if (!selectedRepo) {
    pushBtn.innerText = "❌ No Repo";
    console.error("No repository selected. Please select a repository in the extension popup.");
    
    // Show a more helpful message to the user with instructions
    setTimeout(() => {
      alert("Repository not selected. Please click on the LeetCode Pusher extension icon, then select a repository from the dropdown menu.");
      pushBtn.innerText = "🔄 Push";
    }, 500);
    
    return;
  }

  pushBtn.innerText = "⏳ Loading";
  pushBtn.disabled = true;

  try {
    console.log(`Pushing to repository: ${selectedRepo}`);
    

    // 백엔드가 기대하는 형식의 요청 본문 구성
    const requestBody = { 
      filename, 
      code,
      selected_repo: selectedRepo  // 백엔드가 필요로 하는 필수 필드
    };
    
    // 필수 필드 체크

    if (!filename || !code || !selectedRepo) {
      pushBtn.innerText = "❌ Invalid Data";
      console.error("Missing required fields for push", { filename, codeLength: code?.length, selectedRepo });
      return;
    }
    

    // 요청 로그
    console.log("Request to:", `${API_BASE_URL}/push-code`);
    console.log("Request body:", { ...requestBody, code: code.length > 50 ? `${code.substring(0, 50)}...` : code });
    console.log("JWT Length:", jwt ? jwt.length : 'none');
    console.log("JWT Token (first 20 chars):", jwt ? jwt.substring(0, 20) + '...' : 'none');
    
    // 올바른 인증 헤더 구성
    const authHeader = `Bearer ${jwt}`;
    
    // 테스트로 다른 형식의 헤더도 시도
    const res = await fetch(`${API_BASE_URL}/push-code`, {
      method: "POST",  // 백엔드는 POST 메소드 기대
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader,

        "Accept": "application/json"
      },
      mode: 'cors',

      cache: 'no-cache', // 캐시 문제 방지
      body: JSON.stringify(requestBody)
    });

    // 응답 상태 코드와 헤더 로깅 추가
    console.log(`API Response Status: ${res.status} ${res.statusText}`);
    console.log("Response Headers:", Object.fromEntries(res.headers.entries()));

    if (!res.ok) {
      // 에러 응답에 대한 개선된 처리
      let errorInfo = "";
      try {
        // JSON 형식 응답 처리 시도
        const errorData = await res.json();
        console.error("Server JSON error:", errorData);
        errorInfo = JSON.stringify(errorData);
      } catch (jsonError) {
        // 텍스트 형식 응답 처리 (일반 오류 메시지)
        const errorText = await res.text();
        console.error("Server text error:", errorText);
        errorInfo = errorText;
      }
      throw new Error(`HTTP error! status: ${res.status}, details: ${errorInfo}`);
    }

    const data = await res.json();
    console.log("API Success Response:", data);

    if (data.message === "Already pushed!") {
      pushBtn.innerText = "⚠️ Already";
    } else if (data.message === "No change") {
      pushBtn.innerText = "🟡 No change";
    } else {
      const pushedAt = data.pushed_at || new Date().toISOString();
      chrome.storage.local.set({ last_push: pushedAt }, () => {
        console.log(`[Push] Last push: ${pushedAt}`);
      });
      pushBtn.innerText = "✅ Push";

    }
  } catch (err) {
    console.error("Push error:", err);
    pushBtn.innerText = "❌ Error";
    if (err.message) console.error("Error message:", err.message);
    if (err.stack) console.error("Error stack:", err.stack);
  }

  pushBtn.disabled = false;
  await getStatsFromAPI();
}

// Add a function to check and log the selected repository
function checkSelectedRepository() {
  chrome.storage.local.get(['selected_repo'], (result) => {
    const selectedRepo = result.selected_repo;
    if (selectedRepo) {
      console.log(`[LeetCode Pusher] Using repository: ${selectedRepo}`);
    } else {
      console.warn("[LeetCode Pusher] No repository selected. Push function will not work.");
    }
  });
}

function waitForEditorAndInsertButton() {
  // Check if we're on a problem-related page
  const urlParts = window.location.pathname.split("/");
  const problemsIndex = urlParts.indexOf("problems");
  
  if (problemsIndex === -1) return; // Not a problem page
  
  const addButtonWithRetry = () => {
    const editor = document.querySelector('.monaco-editor');
    if (editor) {
      addPushButton();
    } else {
      let retry = 0;
      const interval = setInterval(() => {
        if (document.querySelector('.monaco-editor')) {
          addPushButton();
          clearInterval(interval);
        } else if (retry++ > 50) {
          clearInterval(interval);
        }
      }, 100);
    }
  };

  // Initial attempt
  addButtonWithRetry();

  // Also set up a mutation observer to handle dynamic content loading
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.addedNodes.length) {
        addButtonWithRetry();
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

waitForEditorAndInsertButton();
const observer = new MutationObserver(() => {
  waitForEditorAndInsertButton();
  monitorSubmitButton();
});
observer.observe(document.body, { childList: true, subtree: true });

// first call
setTimeout(() => {
  waitForEditorAndInsertButton();
  monitorSubmitButton();
  checkSelectedRepository(); // Check repository on page load
}, 1000);

document.addEventListener("keydown", function (e) {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const isShortcut = (isMac && e.metaKey && !e.ctrlKey && !e.altKey && e.key === 'm') ||
                     (!isMac && e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'm');

  if (isShortcut) {
    e.preventDefault(); // prevent browser behavior like minimizing
    const pushBtn = document.getElementById("leet-github-push");
    if (pushBtn) {
      console.log("Shortcut triggered: Push to GitHub");
      handlePushButtonClick();
    } else {
      console.warn("Push button not found.");
    }
  }
});