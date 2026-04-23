import type { Request, Response, NextFunction } from 'express';

// 白名单路径集合：登录 API + 登录页静态资源，使用精确匹配
const PUBLIC_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/status',
  '/login.css',
  '/login.js',
]);

// 内联登录页 HTML 模板，避免构建时文件复制问题
const LOGIN_PAGE_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>登录 - WikiBrowser</title>
  <style>
    :root {
      --bg: #faf8f2;
      --card-bg: #fffdf7;
      --text: #1a1815;
      --text-secondary: #42403a;
      --text-muted: #726e64;
      --border: #e5e2d8;
      --border-light: #efecdf;
      --input-bg: #fffdf7;
      --input-focus-border: #2563eb;
      --input-focus-shadow: rgba(37, 99, 235, 0.15);
      --btn-bg: #1a1815;
      --btn-text: #fffdf7;
      --btn-hover: #42403a;
      --btn-active: #1a1815;
      --error: #dc2626;
      --error-bg: #fef2f2;
      --error-border: #fecaca;
      --shadow-lg: 0 12px 40px rgba(0, 0, 0, 0.08);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1c1a16;
        --card-bg: #24221c;
        --text: #e8e5d8;
        --text-secondary: #b5b1a3;
        --text-muted: #8a8577;
        --border: #38352c;
        --border-light: #2c2922;
        --input-bg: #2c2922;
        --input-focus-border: #5b8def;
        --input-focus-shadow: rgba(91, 141, 239, 0.2);
        --btn-bg: #e8e5d8;
        --btn-text: #1c1a16;
        --btn-hover: #b5b1a3;
        --btn-active: #e8e5d8;
        --error: #ef4444;
        --error-bg: #7f1d1d;
        --error-border: #991b1b;
        --shadow-lg: 0 12px 40px rgba(0, 0, 0, 0.4);
      }
    }
    *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
        "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif;
      background-color: var(--bg); color: var(--text);
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      -webkit-font-smoothing: antialiased;
    }
    .login-card {
      width: 100%; max-width: 380px; padding: 40px 32px;
      background: var(--card-bg); border: 1px solid var(--border-light);
      border-radius: 16px; box-shadow: var(--shadow-lg);
    }
    .brand { text-align: center; margin-bottom: 32px; }
    .brand-icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: 56px; height: 56px; border-radius: 14px;
      background: var(--btn-bg); color: var(--btn-text); margin-bottom: 16px;
    }
    .brand-icon svg { width: 28px; height: 28px; }
    .brand-title { font-size: 22px; font-weight: 700; color: var(--text); letter-spacing: -0.3px; }
    .form-group { margin-bottom: 20px; }
    .input-wrapper { position: relative; display: flex; align-items: center; }
    .input-field {
      width: 100%; height: 44px; padding: 0 44px 0 14px;
      font-size: 15px; color: var(--text); background: var(--input-bg);
      border: 1px solid var(--border); border-radius: 10px; outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .input-field::placeholder { color: var(--text-muted); }
    .input-field:focus { border-color: var(--input-focus-border); box-shadow: 0 0 0 3px var(--input-focus-shadow); }
    .toggle-btn {
      position: absolute; right: 4px;
      display: inline-flex; align-items: center; justify-content: center;
      width: 36px; height: 36px; padding: 0; border: none;
      background: transparent; color: var(--text-muted);
      cursor: pointer; border-radius: 8px; transition: color 0.15s, background 0.15s;
    }
    .toggle-btn:hover { color: var(--text-secondary); background: var(--border-light); }
    .toggle-btn svg { width: 20px; height: 20px; }
    .error-msg {
      display: none; align-items: center; gap: 8px;
      padding: 10px 14px; margin-bottom: 20px; font-size: 14px;
      color: var(--error); background: var(--error-bg);
      border: 1px solid var(--error-border); border-radius: 10px; line-height: 1.4;
    }
    .error-msg.visible { display: flex; }
    .error-msg svg { width: 18px; height: 18px; flex-shrink: 0; }
    .submit-btn {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      width: 100%; height: 44px; font-size: 15px; font-weight: 600;
      color: var(--btn-text); background: var(--btn-bg); border: none;
      border-radius: 10px; cursor: pointer; transition: background 0.15s, opacity 0.15s;
      letter-spacing: 0.2px;
    }
    .submit-btn:hover { background: var(--btn-hover); }
    .submit-btn:active { background: var(--btn-active); }
    .submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .submit-btn .spinner {
      display: none; width: 18px; height: 18px;
      border: 2px solid transparent; border-top-color: currentColor;
      border-radius: 50%; animation: spin 0.6s linear infinite;
    }
    .submit-btn.loading .spinner { display: inline-block; }
    .submit-btn.loading .btn-text { display: none; }
    .submit-btn.loading .btn-loading-text { display: inline; }
    .btn-loading-text { display: none; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="login-card">
    <div class="brand">
      <div class="brand-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      </div>
      <div class="brand-title">WikiBrowser</div>
    </div>
    <div class="error-msg" id="errorMsg">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <span id="errorText">密码错误，请重试</span>
    </div>
    <form id="loginForm" autocomplete="off">
      <div class="form-group">
        <div class="input-wrapper">
          <input type="password" id="passwordInput" class="input-field" placeholder="请输入访问密码" autofocus/>
          <button type="button" class="toggle-btn" id="toggleBtn" aria-label="切换密码可见性">
            <svg id="eyeOffIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
            <svg id="eyeOnIcon" style="display:none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
        </div>
      </div>
      <button type="submit" class="submit-btn" id="submitBtn">
        <span class="btn-text">登录</span>
        <span class="btn-loading-text">验证中</span>
        <span class="spinner"></span>
      </button>
    </form>
  </div>
  <script>
  (function(){
    'use strict';
    var redirect='{{redirect}}'||'/';
    var passwordInput=document.getElementById('passwordInput');
    var toggleBtn=document.getElementById('toggleBtn');
    var eyeOffIcon=document.getElementById('eyeOffIcon');
    var eyeOnIcon=document.getElementById('eyeOnIcon');
    var loginForm=document.getElementById('loginForm');
    var submitBtn=document.getElementById('submitBtn');
    var errorMsg=document.getElementById('errorMsg');
    var errorText=document.getElementById('errorText');
    toggleBtn.addEventListener('click',function(){
      var isPassword=passwordInput.type==='password';
      passwordInput.type=isPassword?'text':'password';
      eyeOffIcon.style.display=isPassword?'none':'';
      eyeOnIcon.style.display=isPassword?'':'none';
    });
    passwordInput.addEventListener('input',function(){errorMsg.classList.remove('visible')});
    loginForm.addEventListener('submit',function(e){
      e.preventDefault();
      var password=passwordInput.value.trim();
      if(!password){showError('请输入密码');return;}
      setLoading(true);errorMsg.classList.remove('visible');
      fetch('/api/auth/login',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({password:password})
      }).then(function(res){
        return res.json().then(function(data){return{ok:res.ok,status:res.status,data:data}});
      }).then(function(result){
        if(result.ok){window.location.href=redirect;}
        else{showError(result.data.error||'密码错误，请重试');setLoading(false);passwordInput.focus();passwordInput.select();}
      }).catch(function(){showError('网络错误，请检查连接后重试');setLoading(false)});
    });
    function showError(message){errorText.textContent=message;errorMsg.classList.add('visible');}
    function setLoading(loading){
      submitBtn.disabled=loading;
      if(loading){submitBtn.classList.add('loading');}
      else{submitBtn.classList.remove('loading');}
    }
  })();
  </script>
</body>
</html>`;

/**
 * 生成登录页 HTML，将重定向地址注入模板
 * @param redirect - 登录成功后的重定向目标路径
 * @returns 替换占位符后的完整 HTML 字符串
 */
function getLoginPage(redirect: string): string {
  return LOGIN_PAGE_TEMPLATE.replace('{{redirect}}', decodeURIComponent(redirect) || '/');
}

/**
 * 认证中间件：保护全部 HTTP 端点
 * - 白名单路径精确匹配放行
 * - 已认证请求放行
 * - 未认证 API 请求返回 401 JSON
 * - 未认证页面请求返回登录 HTML
 * @param req - Express 请求对象
 * @param res - Express 响应对象
 * @param next - Express next 函数
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // 白名单精确匹配放行
  if (PUBLIC_PATHS.has(req.path)) {
    return next();
  }

  // 已认证放行
  if ((req.session as any)?.authenticated) {
    return next();
  }

  // 未认证处理
  if (req.path.startsWith('/api/')) {
    res.status(401).json({ success: false, error: '未授权访问' });
  } else {
    res.send(getLoginPage(req.path));
  }
}
