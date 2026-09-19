(function initializeAccountModule(global) {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  let syncState = null;
  let profile = null;
  let membership = null;
  let devices = [];
  let callbacks = {};
  let registrationCodeRequested = false;
  let registrationEmail = "";

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function errorMessage(error) {
    const message = String(error?.message || "操作失败，请稍后重试");
    const translations = [
      [/Email address is already registered/i, "该邮箱已经注册"],
      [/Invalid email or password/i, "邮箱或密码不正确"],
      [/Current password is incorrect/i, "当前密码不正确"],
      [/New password must be different/i, "新密码不能与当前密码相同"],
      [/Invalid or expired/i, "验证码无效或已过期"],
      [/fetch failed/i, "无法连接同步服务，请检查服务是否运行"],
      [/aborted/i, "连接同步服务超时，请稍后重试"],
    ];
    const matched = translations.find(([pattern]) => pattern.test(message));
    return matched ? matched[1] : message;
  }

  function currentAccount() {
    return syncState?.account || {};
  }

  function displayName() {
    const savedName = String(profile?.displayName || currentAccount().displayName || "").trim();
    if (savedName) return savedName;
    const email = String(profile?.email || currentAccount().email || "").trim();
    const prefix = email.split("@")[0] || "MyTodo 用户";
    return prefix.slice(0, 24);
  }

  function avatarText() {
    return Array.from(displayName())[0]?.toUpperCase() || "未";
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("zh-CN", { year: "numeric", month: "long" });
  }

  function formatSeen(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "尚未同步";
    const elapsed = Date.now() - date.getTime();
    if (elapsed < 60_000) return "刚刚同步";
    if (elapsed < 3_600_000) return `${Math.max(1, Math.floor(elapsed / 60_000))} 分钟前同步`;
    if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前同步`;
    return date.toLocaleDateString("zh-CN") + " 同步";
  }

  function phaseInfo() {
    const phase = syncState?.phase || (currentAccount().enabled ? "idle" : "disabled");
    if (phase === "offline") return { text: "离线模式", state: "offline" };
    if (phase === "attention") return { text: "需要处理", state: "attention" };
    if (phase === "syncing" || phase === "connecting") return { text: "正在同步", state: "online" };
    return { text: currentAccount().enabled ? "同步正常" : "本地模式", state: currentAccount().enabled ? "online" : "" };
  }

  function renderNavigation() {
    const avatar = $("#accountNavAvatar");
    const indicator = $("#accountNavState");
    if (!avatar || !indicator) return;
    avatar.textContent = currentAccount().enabled ? avatarText() : "未";
    avatar.dataset.preset = profile?.avatarPreset || currentAccount().avatarPreset || "indigo";
    indicator.dataset.state = phaseInfo().state;
  }

  function renderDevices() {
    const target = $("#accountDeviceList");
    if (!target) return;
    const active = devices.filter((device) => !device.revokedAt);
    $("#accountDeviceCount").textContent = String(active.length);
    if (!active.length) {
      target.innerHTML = '<span class="account-empty">尚未读取到已连接设备</span>';
      return;
    }
    target.innerHTML = active.map((device) => {
      const platform = String(device.platform || "").toUpperCase();
      const mark = ["ANDROID", "IOS"].includes(platform) ? "M" : "PC";
      const action = device.isCurrent
        ? '<span class="account-device-current">当前设备</span>'
        : `<button type="button" class="account-device-remove" data-device-id="${escapeHtml(device.id)}" data-device-name="${escapeHtml(device.name)}">移除</button>`;
      return `<div class="account-device-item"><span class="account-device-icon">${mark}</span><div class="account-device-copy"><strong>${escapeHtml(device.name || "未命名设备")}</strong><span>${escapeHtml(platform || "未知平台")} · ${escapeHtml(formatSeen(device.lastSeenAt))}</span></div>${action}</div>`;
    }).join("");
    target.querySelectorAll(".account-device-remove").forEach((button) => {
      button.addEventListener("click", () => openAuth("revoke", {
        deviceId: button.dataset.deviceId,
        deviceName: button.dataset.deviceName,
      }));
    });
  }

  function render() {
    const enabled = currentAccount().enabled === true;
    $("#accountSignedOut")?.classList.toggle("hidden", enabled);
    $("#accountSignedIn")?.classList.toggle("hidden", !enabled);
    renderNavigation();
    if (!enabled) return;

    const email = profile?.email || currentAccount().email || "未绑定邮箱";
    const verified = profile?.emailVerified === true || currentAccount().emailVerified === true;
    const name = displayName();
    const phase = phaseInfo();
    $("#accountLargeAvatar").textContent = avatarText();
    $("#accountLargeAvatar").dataset.preset = profile?.avatarPreset || currentAccount().avatarPreset || "indigo";
    $("#accountDisplayName").textContent = name;
    $("#accountNickname").textContent = name;
    $("#accountEmailSummary").textContent = email + " · MyTodo 用户";
    $("#accountEmail").textContent = email;
    $("#accountPhone").textContent = profile?.phone || "未绑定 · 功能预留";
    $("#accountVerifiedBadge").textContent = verified ? "邮箱已验证" : "邮箱未验证";
    const cachedMembership = membership || currentAccount().membership;
    const planName = cachedMembership?.plan?.name || cachedMembership?.planName || "免费版";
    $("#accountPlanBadge").textContent = planName;
    $("#accountPlanName").textContent = planName;
    const enabledEntitlements = Array.isArray(cachedMembership?.entitlements)
      ? cachedMembership.entitlements.filter((entry) => entry.enabled).length
      : 0;
    $("#accountPlanSummary").textContent = enabledEntitlements
      ? `当前包含 ${enabledEntitlements} 项可用权益；基础待办与离线使用始终保留。`
      : "基础待办、本地提醒和离线使用保持可用；会员能力将在后续版本开放。";
    const joined = formatDate(profile?.createdAt || currentAccount().registeredAt);
    $("#accountJoinedBadge").textContent = joined ? joined + "加入" : "";
    $("#accountVerifyAction").classList.toggle("hidden", verified);
    $("#accountPendingCount").textContent = String(Number(syncState?.pendingCount) || 0);
    const stats = typeof callbacks.getTodoStats === "function" ? callbacks.getTodoStats() : {};
    $("#accountCompletedCount").textContent = String(Number(stats.completed) || 0);
    const badge = $("#accountSyncBadge");
    badge.textContent = phase.text;
    badge.dataset.state = phase.state;
    renderDevices();
  }

  function setSyncState(nextState) {
    if (nextState && typeof nextState === "object") syncState = { ...nextState };
    render();
  }

  async function refresh(options = {}) {
    if (!syncState) syncState = await global.electronAPI.getSyncState();
    if (!currentAccount().enabled) {
      profile = null;
      devices = [];
      render();
      return;
    }
    const [profileResult, devicesResult, membershipResult] = await Promise.allSettled([
      global.electronAPI.getSyncAccountProfile(),
      global.electronAPI.listSyncDevices(),
      global.electronAPI.getMembershipState(),
    ]);
    if (profileResult.status === "fulfilled") profile = profileResult.value;
    if (devicesResult.status === "fulfilled") devices = Array.isArray(devicesResult.value) ? devicesResult.value : [];
    if (membershipResult.status === "fulfilled") membership = membershipResult.value;
    render();
    if (options.announce && [profileResult, devicesResult, membershipResult].some((result) => result.status === "rejected")) {
      callbacks.showToast?.("同步服务暂时不可用，已显示本机账户信息");
    }
  }

  function modalStatus(message, success = false) {
    const target = $("#accountAuthStatus");
    if (!target) return;
    target.textContent = message || "";
    target.classList.toggle("success", success);
  }

  function setBusy(button, busy, text) {
    if (!button) return;
    if (!button.dataset.defaultText) button.dataset.defaultText = button.textContent;
    button.disabled = busy;
    button.textContent = busy ? text : button.dataset.defaultText;
  }

  function authHeader(title, subtitle) {
    $("#accountAuthTitle").textContent = title;
    $("#accountAuthSubtitle").textContent = subtitle;
  }

  function loginMarkup() {
    return `<form class="account-auth-form" id="accountLoginForm"><div class="form-row"><label for="accountLoginEmail">邮箱</label><input id="accountLoginEmail" type="email" maxlength="254" autocomplete="email" required></div><div class="form-row"><label for="accountLoginPassword">密码</label><input id="accountLoginPassword" type="password" minlength="8" maxlength="128" autocomplete="current-password" required></div><p class="account-auth-note">登录后会合并本机已有待办并启用同步，断网时仍可继续使用。</p><p class="account-auth-status" id="accountAuthStatus" aria-live="polite"></p><div class="account-auth-actions"><button type="button" class="btn secondary account-auth-back" data-auth-view="reset">忘记密码</button><button type="button" class="btn secondary" data-auth-view="register">创建账户</button><button type="submit" class="btn primary" id="accountLoginSubmit">登录</button></div></form>`;
  }

  function registerMarkup() {
    return `<form class="account-auth-form" id="accountRegisterForm"><div class="form-row"><label for="accountRegisterEmail">邮箱</label><input id="accountRegisterEmail" type="email" maxlength="254" autocomplete="email" required></div><div class="form-row"><label for="accountRegisterPassword">密码</label><input id="accountRegisterPassword" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></div><div class="form-row"><label for="accountRegisterConfirm">确认密码</label><input id="accountRegisterConfirm" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></div><div class="form-row"><label for="accountRegisterCode">邮箱验证码</label><div class="account-code-row"><input id="accountRegisterCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6 位验证码"><button type="button" class="btn secondary" id="accountRegisterSendCode">发送验证码</button></div></div><label class="account-agreement"><input type="checkbox" id="accountRegisterAgreement"><span>我已阅读并同意 <a href="#" data-agreement="terms">用户协议</a> 和 <a href="#" data-agreement="privacy">隐私政策</a>，并确认将本机已有待办同步至此账户。</span></label><p class="account-auth-note">手机号登录已预留，目前注册和找回账户均使用邮箱。</p><p class="account-auth-status" id="accountAuthStatus" aria-live="polite"></p><div class="account-auth-actions"><button type="button" class="btn secondary account-auth-back" data-auth-view="login">已有账户</button><button type="submit" class="btn primary" id="accountRegisterSubmit">验证并完成</button></div></form>`;
  }

  function resetMarkup() {
    return `<form class="account-auth-form" id="accountResetForm"><div class="form-row"><label for="accountResetEmail">注册邮箱</label><input id="accountResetEmail" type="email" maxlength="254" autocomplete="email" required></div><div class="form-row"><label for="accountResetCode">邮箱验证码</label><div class="account-code-row"><input id="accountResetCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6 位验证码"><button type="button" class="btn secondary" id="accountResetSendCode">发送验证码</button></div></div><div class="form-row"><label for="accountResetPassword">新密码</label><input id="accountResetPassword" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></div><div class="form-row"><label for="accountResetConfirm">确认新密码</label><input id="accountResetConfirm" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></div><p class="account-auth-status" id="accountAuthStatus" aria-live="polite"></p><div class="account-auth-actions"><button type="button" class="btn secondary account-auth-back" data-auth-view="login">返回登录</button><button type="submit" class="btn primary" id="accountResetSubmit">重置密码</button></div></form>`;
  }

  function verifyMarkup() {
    return `<form class="account-auth-form" id="accountVerifyForm"><p class="account-confirm-copy">验证码将发送到 <strong>${escapeHtml(profile?.email || currentAccount().email)}</strong>。验证后可使用邮箱安全找回账户。</p><div class="form-row"><label for="accountVerifyCode">邮箱验证码</label><div class="account-code-row"><input id="accountVerifyCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6 位验证码"><button type="button" class="btn secondary" id="accountVerifySendCode">发送验证码</button></div></div><p class="account-auth-status" id="accountAuthStatus" aria-live="polite"></p><div class="account-auth-actions"><button type="button" class="btn secondary account-auth-back" data-close-account-auth>取消</button><button type="submit" class="btn primary" id="accountVerifySubmit">完成验证</button></div></form>`;
  }

  function passwordMarkup() {
    return `<form class="account-auth-form" id="accountPasswordForm"><div class="form-row"><label for="accountCurrentPassword">当前密码</label><input id="accountCurrentPassword" type="password" maxlength="128" autocomplete="current-password" required></div><div class="form-row"><label for="accountNewPassword">新密码</label><input id="accountNewPassword" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></div><div class="form-row"><label for="accountNewPasswordConfirm">确认新密码</label><input id="accountNewPasswordConfirm" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></div><p class="account-auth-note">修改成功后，其他设备需要重新登录。</p><p class="account-auth-status" id="accountAuthStatus" aria-live="polite"></p><div class="account-auth-actions"><button type="button" class="btn secondary account-auth-back" data-close-account-auth>取消</button><button type="submit" class="btn primary" id="accountPasswordSubmit">保存新密码</button></div></form>`;
  }

  function profileMarkup() {
    const selected = profile?.avatarPreset || currentAccount().avatarPreset || "indigo";
    const choices = [
      ["indigo", "靛蓝"], ["emerald", "青绿"], ["rose", "玫红"], ["amber", "琥珀"], ["slate", "石墨"],
    ].map(([value, label]) => `<label class="account-avatar-choice" data-preset="${value}"><input type="radio" name="accountAvatarPreset" value="${value}" ${value === selected ? "checked" : ""}><span>${escapeHtml(label)}</span></label>`).join("");
    return `<form class="account-auth-form" id="accountProfileForm"><div class="form-row"><label for="accountProfileName">昵称</label><input id="accountProfileName" maxlength="40" autocomplete="nickname" value="${escapeHtml(displayName())}" required></div><div class="form-row"><label>头像颜色</label><div class="account-avatar-options">${choices}</div></div><p class="account-auth-status" id="accountAuthStatus" aria-live="polite"></p><div class="account-auth-actions"><button type="button" class="btn secondary account-auth-back" data-close-account-auth>取消</button><button type="submit" class="btn primary" id="accountProfileSubmit">保存资料</button></div></form>`;
  }

  async function submitProfile(event) {
    event.preventDefault();
    const button = $("#accountProfileSubmit");
    setBusy(button, true, "正在保存");
    try {
      const result = await global.electronAPI.updateSyncAccountProfile({
        displayName: $("#accountProfileName").value,
        avatarPreset: document.querySelector('input[name="accountAvatarPreset"]:checked')?.value,
      });
      profile = result.profile;
      setSyncState(result.state);
      closeModal();
      callbacks.showToast?.("账户资料已更新");
    } catch (error) {
      modalStatus(errorMessage(error));
    } finally {
      setBusy(button, false);
    }
  }

  function confirmMarkup(message, confirmText, action) {
    return `<p class="account-confirm-copy">${escapeHtml(message)}</p><p class="account-auth-status" id="accountAuthStatus" aria-live="polite"></p><div class="account-auth-actions"><button type="button" class="btn secondary account-auth-back" data-close-account-auth>取消</button><button type="button" class="btn primary" id="accountConfirmAction" data-action="${escapeHtml(action)}">${escapeHtml(confirmText)}</button></div>`;
  }

  function deleteAccountMarkup() {
    return `<form class="account-auth-form" id="accountDeleteForm"><p class="account-confirm-copy">注销后云端账户、同步数据和设备记录将被删除。本机待办会保留并切换为离线模式。</p><div class="form-row"><label for="accountDeletePassword">当前密码</label><input id="accountDeletePassword" type="password" minlength="8" maxlength="128" autocomplete="current-password" required></div><p class="account-auth-status" id="accountAuthStatus" aria-live="polite"></p><div class="account-auth-actions"><button type="button" class="btn secondary account-auth-back" data-close-account-auth>取消</button><button type="submit" class="btn primary" id="accountDeleteSubmit">确认注销</button></div></form>`;
  }

  async function submitAccountDeletion(event) {
    event.preventDefault();
    const button = $("#accountDeleteSubmit");
    setBusy(button, true, "正在注销");
    try {
      const next = await global.electronAPI.deleteSyncAccount({
        password: $("#accountDeletePassword").value,
      });
      profile = null;
      membership = null;
      devices = [];
      setSyncState(next);
      closeModal();
      callbacks.showToast?.("云端账户已注销，本机待办已保留");
      callbacks.setPage?.("home");
    } catch (error) {
      modalStatus(errorMessage(error));
    } finally {
      setBusy(button, false);
    }
  }

  function closeModal() {
    if (!$("#accountLegalModal")?.classList.contains("hidden")) {
      $("#accountLegalModal").classList.add("hidden");
      return;
    }
    $("#accountAuthModal")?.classList.add("hidden");
  }

  function isModalOpen() {
    return !$("#accountAuthModal")?.classList.contains("hidden") ||
      !$("#accountLegalModal")?.classList.contains("hidden");
  }

  function openLegalDocument(type) {
    const privacy = type === "privacy";
    $("#accountLegalTitle").textContent = privacy ? "MyTodo 隐私政策" : "MyTodo 用户协议";
    $("#accountLegalContent").innerHTML = privacy
      ? `<p>生效日期：2026 年 9 月 18 日</p><h3>我们处理哪些数据</h3><p>未登录时，待办、提醒设置和备份仅保存在你选择的本机目录。启用同步后，服务器会处理邮箱、昵称、头像样式、待办内容、提醒配置、设备记录和必要的安全日志。手机号功能尚未开放，当前不收集手机号。</p><h3>如何使用数据</h3><p>数据仅用于账户验证、多端同步、提醒、设备管理、安全防护和故障排查。MyTodo 不出售个人信息，也不使用待办内容制作广告画像。</p><h3>存储与删除</h3><p>密码、令牌和验证码均以安全摘要形式保存。你可以导出本地数据、退出其他设备，或在账户中心注销云端账户。注销会删除云端账户及同步数据，本机待办仍会保留。</p><h3>第三方服务</h3><p>邮件服务商会为发送注册和找回验证码处理收件邮箱；服务器与网络服务商会处理提供服务所必需的运行信息。</p><h3>联系我们</h3><p>可通过 GitHub 项目仓库 nhmt1117/MyTodo 提交隐私相关问题。完整文本随安装包的 PRIVACY_POLICY.md 提供。</p>`
      : `<p>生效日期：2026 年 9 月 18 日</p><h3>服务内容</h3><p>MyTodo 提供本地待办、日历、提醒、备份和可选的账户同步服务。未登录或断网时，本地功能仍可使用。</p><h3>账户责任</h3><p>请使用可正常接收邮件的邮箱并妥善保管密码与设备。不得利用服务实施违法活动、干扰服务或访问他人数据。</p><h3>数据与提醒</h3><p>请为重要数据保留备份。系统休眠、通知权限、网络和设备状态可能影响提醒送达，重要事项仍需自行确认。</p><h3>账户注销</h3><p>你可以在账户中心注销云端账户。云端账户及同步数据会被删除，当前电脑中的本地待办不会自动删除。</p><h3>服务变更</h3><p>MyTodo 可能为安全和功能改进进行更新。付费会员尚未开放，当前页面不构成付费承诺。完整文本随安装包的 USER_AGREEMENT.md 提供。</p>`;
    $("#accountLegalModal").classList.remove("hidden");
  }

  function bindCommonModalControls() {
    $("#accountAuthContent").querySelectorAll("[data-auth-view]").forEach((button) => button.addEventListener("click", () => openAuth(button.dataset.authView)));
    $("#accountAuthContent").querySelectorAll("[data-close-account-auth]").forEach((button) => button.addEventListener("click", closeModal));
    $("#accountAuthContent").querySelectorAll("[data-agreement]").forEach((link) => link.addEventListener("click", (event) => {
      event.preventDefault();
      openLegalDocument(link.dataset.agreement);
    }));
  }

  async function submitLogin(event) {
    event.preventDefault();
    const button = $("#accountLoginSubmit");
    setBusy(button, true, "正在登录");
    modalStatus("");
    try {
      const result = await global.electronAPI.loginSyncAccount({
        email: $("#accountLoginEmail").value,
        password: $("#accountLoginPassword").value,
        confirmExistingUpload: true,
      });
      setSyncState(result);
      await refresh();
      closeModal();
      callbacks.showToast?.("登录成功，待办已开始同步");
      callbacks.setPage?.("account");
    } catch (error) {
      modalStatus(errorMessage(error));
    } finally {
      setBusy(button, false);
    }
  }

  function validateRegistration() {
    const email = $("#accountRegisterEmail").value.trim().toLowerCase();
    const password = $("#accountRegisterPassword").value;
    const confirm = $("#accountRegisterConfirm").value;
    if (!email || !email.includes("@")) throw new Error("请输入有效的邮箱地址");
    if (password.length < 8) throw new Error("密码至少需要 8 个字符");
    if (password !== confirm) throw new Error("两次输入的密码不一致");
    if (!$("#accountRegisterAgreement").checked) throw new Error("请先阅读并同意用户协议与隐私政策");
    return { email, password };
  }

  async function sendRegistrationCode() {
    const button = $("#accountRegisterSendCode");
    setBusy(button, true, "正在发送");
    modalStatus("");
    try {
      const credentials = validateRegistration();
      await global.electronAPI.requestSyncRegistrationCode({
        email: credentials.email,
        serverUrl: currentAccount().serverUrl,
      });
      registrationCodeRequested = true;
      registrationEmail = credentials.email;
      modalStatus(`验证码已发送到 ${registrationEmail}`, true);
      button.dataset.defaultText = "重新发送";
    } catch (error) {
      modalStatus(errorMessage(error));
    } finally {
      setBusy(button, false);
    }
  }

  async function submitRegistration(event) {
    event.preventDefault();
    if (!registrationCodeRequested) {
      modalStatus("请先发送邮箱验证码");
      return;
    }
    const code = $("#accountRegisterCode").value.trim();
    if (!/^\d{6}$/.test(code)) {
      modalStatus("请输入六位邮箱验证码");
      return;
    }
    const button = $("#accountRegisterSubmit");
    setBusy(button, true, "正在创建");
    try {
      const credentials = validateRegistration();
      if (credentials.email !== registrationEmail) {
        modalStatus("邮箱已修改，请重新发送验证码");
        registrationCodeRequested = false;
        return;
      }
      const result = await global.electronAPI.registerSyncAccount({
        ...credentials,
        code,
        confirmExistingUpload: true,
      });
      setSyncState(result);
      await refresh();
      closeModal();
      callbacks.showToast?.("账户创建完成，邮箱已验证");
      callbacks.setPage?.("account");
    } catch (error) {
      modalStatus(errorMessage(error));
    } finally {
      setBusy(button, false);
    }
  }

  async function sendResetCode() {
    const email = $("#accountResetEmail").value.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      modalStatus("请输入有效的邮箱地址");
      return;
    }
    const button = $("#accountResetSendCode");
    setBusy(button, true, "正在发送");
    try {
      await global.electronAPI.requestSyncPasswordReset({ email, serverUrl: currentAccount().serverUrl });
      modalStatus("如果邮箱已注册，验证码将发送到该邮箱", true);
      button.dataset.defaultText = "重新发送";
    } catch (error) {
      modalStatus(errorMessage(error));
    } finally {
      setBusy(button, false);
    }
  }

  async function submitReset(event) {
    event.preventDefault();
    const password = $("#accountResetPassword").value;
    if (password.length < 8) return modalStatus("新密码至少需要 8 个字符");
    if (password !== $("#accountResetConfirm").value) return modalStatus("两次输入的新密码不一致");
    const button = $("#accountResetSubmit");
    setBusy(button, true, "正在重置");
    try {
      await global.electronAPI.resetSyncPassword({
        email: $("#accountResetEmail").value,
        code: $("#accountResetCode").value,
        newPassword: password,
        serverUrl: currentAccount().serverUrl,
      });
      syncState = await global.electronAPI.getSyncState();
      render();
      callbacks.showToast?.("密码已重置，请重新登录");
      openAuth("login");
    } catch (error) {
      modalStatus(errorMessage(error));
    } finally {
      setBusy(button, false);
    }
  }

  async function sendVerificationCode() {
    const button = $("#accountVerifySendCode");
    setBusy(button, true, "正在发送");
    try {
      await global.electronAPI.requestSyncEmailVerification();
      modalStatus("验证码已发送，请检查邮箱", true);
      button.dataset.defaultText = "重新发送";
    } catch (error) {
      modalStatus(errorMessage(error));
    } finally {
      setBusy(button, false);
    }
  }

  async function submitVerification(event) {
    event.preventDefault();
    const button = $("#accountVerifySubmit");
    setBusy(button, true, "正在验证");
    try {
      const result = await global.electronAPI.verifySyncEmail({ code: $("#accountVerifyCode").value });
      profile = result.profile;
      setSyncState(result.state);
      closeModal();
      callbacks.showToast?.("邮箱验证成功");
    } catch (error) {
      modalStatus(errorMessage(error));
    } finally {
      setBusy(button, false);
    }
  }

  async function submitPassword(event) {
    event.preventDefault();
    const next = $("#accountNewPassword").value;
    if (next.length < 8) return modalStatus("新密码至少需要 8 个字符");
    if (next !== $("#accountNewPasswordConfirm").value) return modalStatus("两次输入的新密码不一致");
    const button = $("#accountPasswordSubmit");
    setBusy(button, true, "正在保存");
    try {
      const result = await global.electronAPI.changeSyncPassword({ currentPassword: $("#accountCurrentPassword").value, newPassword: next });
      closeModal();
      devices = devices.filter((device) => device.isCurrent);
      render();
      callbacks.showToast?.(`密码已修改，${Number(result?.revokedDeviceCount) || 0} 台其他设备需要重新登录`);
    } catch (error) {
      modalStatus(errorMessage(error));
    } finally {
      setBusy(button, false);
    }
  }

  async function runConfirmedAction(context) {
    const button = $("#accountConfirmAction");
    setBusy(button, true, "正在处理");
    try {
      if (context.action === "logout") {
        const next = await global.electronAPI.logoutSyncAccount();
        profile = null;
        membership = null;
        devices = [];
        setSyncState(next);
        closeModal();
        callbacks.showToast?.("已退出账户，本地待办已保留");
        return;
      }
      if (context.action === "revoke") {
        devices = await global.electronAPI.revokeSyncDevice(context.deviceId);
        closeModal();
        render();
        callbacks.showToast?.("设备已移除");
        return;
      }
      if (context.action === "logout-others") {
        const result = await global.electronAPI.logoutOtherSyncDevices();
        closeModal();
        await refresh();
        callbacks.showToast?.(`已退出 ${result.revokedDeviceCount || 0} 台其他设备`);
      }
    } catch (error) {
      modalStatus(errorMessage(error));
    } finally {
      setBusy(button, false);
    }
  }

  function openAuth(view, context = {}) {
    const content = $("#accountAuthContent");
    registrationCodeRequested = false;
    registrationEmail = "";
    if (view === "login") {
      authHeader("登录 MyTodo", "同步待办，同时保留完整离线能力");
      content.innerHTML = loginMarkup();
      $("#accountLoginForm").addEventListener("submit", submitLogin);
    } else if (view === "register") {
      authHeader("创建 MyTodo 账户", "注册与邮箱验证在此一次完成");
      content.innerHTML = registerMarkup();
      $("#accountRegisterForm").addEventListener("submit", submitRegistration);
      $("#accountRegisterSendCode").addEventListener("click", sendRegistrationCode);
    } else if (view === "reset") {
      authHeader("找回密码", "验证邮箱后设置新密码");
      content.innerHTML = resetMarkup();
      $("#accountResetForm").addEventListener("submit", submitReset);
      $("#accountResetSendCode").addEventListener("click", sendResetCode);
    } else if (view === "verify") {
      authHeader("验证邮箱", "完成账户安全验证");
      content.innerHTML = verifyMarkup();
      $("#accountVerifyForm").addEventListener("submit", submitVerification);
      $("#accountVerifySendCode").addEventListener("click", sendVerificationCode);
    } else if (view === "password") {
      authHeader("修改密码", "其他设备将在修改后退出登录");
      content.innerHTML = passwordMarkup();
      $("#accountPasswordForm").addEventListener("submit", submitPassword);
    } else if (view === "profile") {
      authHeader("编辑个人资料", "资料会同步到你的所有设备");
      content.innerHTML = profileMarkup();
      $("#accountProfileForm").addEventListener("submit", submitProfile);
    } else if (view === "logout") {
      authHeader("退出 MyTodo 账户？", "本机数据不会被删除");
      content.innerHTML = confirmMarkup("退出后将停止多端同步，但本机已有待办会完整保留。", "退出登录", "logout");
      $("#accountConfirmAction").addEventListener("click", () => runConfirmedAction({ action: "logout" }));
    } else if (view === "revoke") {
      authHeader("移除这台设备？", "该设备需要重新登录才能继续同步");
      content.innerHTML = confirmMarkup(`确定移除“${context.deviceName || "这台设备"}”吗？`, "确认移除", "revoke");
      $("#accountConfirmAction").addEventListener("click", () => runConfirmedAction({ ...context, action: "revoke" }));
    } else if (view === "logout-others") {
      authHeader("退出其他设备？", "当前电脑将保持登录");
      content.innerHTML = confirmMarkup("其他设备上的同步会停止，需要重新登录后才能继续使用账户。", "确认退出", "logout-others");
      $("#accountConfirmAction").addEventListener("click", () => runConfirmedAction({ action: "logout-others" }));
    } else if (view === "delete") {
      authHeader("注销云端账户？", "此操作无法撤销");
      content.innerHTML = deleteAccountMarkup();
      $("#accountDeleteForm").addEventListener("submit", submitAccountDeletion);
    }
    bindCommonModalControls();
    $("#accountAuthModal").classList.remove("hidden");
  }

  function bind() {
    $("#openAccountLogin")?.addEventListener("click", () => openAuth("login"));
    $("#openAccountRegister")?.addEventListener("click", () => openAuth("register"));
    $("#accountVerifyEmail")?.addEventListener("click", () => openAuth("verify"));
    $("#accountChangePassword")?.addEventListener("click", () => openAuth("password"));
    $("#accountEditProfile")?.addEventListener("click", () => openAuth("profile"));
    $("#accountOpenPassword")?.addEventListener("click", () => openAuth("password"));
    $("#accountLogout")?.addEventListener("click", () => openAuth("logout"));
    $("#accountLogoutOthers")?.addEventListener("click", () => openAuth("logout-others"));
    $("#accountDeleteCloud")?.addEventListener("click", () => openAuth("delete"));
    $("#accountReloadDevices")?.addEventListener("click", () => refresh({ announce: true }));
    $("#accountRefreshDevices")?.addEventListener("click", () => refresh({ announce: true }));
    $("#closeAccountAuth")?.addEventListener("click", closeModal);
    $("#closeAccountLegal")?.addEventListener("click", closeModal);
    $("#confirmAccountLegal")?.addEventListener("click", closeModal);
    $("#accountAuthModal")?.addEventListener("mousedown", (event) => { if (event.target === $("#accountAuthModal")) closeModal(); });
    $("#accountLegalModal")?.addEventListener("mousedown", (event) => { if (event.target === $("#accountLegalModal")) closeModal(); });
  }

  function initialize(options = {}) {
    callbacks = { ...options };
    syncState = options.initialSyncState || syncState;
    bind();
    render();
    return refresh();
  }

  global.accountUI = { closeModal, initialize, isModalOpen, refresh, setSyncState };
})(window);
