let appConfig = {}
let currentDate = new Date()
let sortType = "date-asc"
let selectedCalendarDate = getTodayStr()
let calendarFirstLoad = true // 仅应用启动后首次进入日历时默认显示当天
let calendarTodoCache = null
let calendarDirty = true
const $ = s=>document.querySelector(s)
const $$ = s=>Array.from(document.querySelectorAll(s))
const recurrence = window.todoRecurrence
const cycleTypeLabels = {daily:"每日",weekly:"每周",monthly:"每月"}
function escapeHtml(value){
  const map = {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}
  return String(value ?? "").replace(/[&<>"']/g, ch=>map[ch])
}
function safeDataId(value){
  const id = Number(value)
  return Number.isFinite(id) ? String(id) : ""
}
function clearTitleError(inputId){
  const input = $("#"+inputId)
  const error = $("#"+inputId+"Error")
  input.classList.remove("field-invalid")
  input.removeAttribute("aria-invalid")
  error.textContent = ""
  error.classList.add("hidden")
}
function showTitleError(inputId){
  const input = $("#"+inputId)
  const error = $("#"+inputId+"Error")
  input.classList.add("field-invalid")
  input.setAttribute("aria-invalid", "true")
  error.textContent = "请填写任务标题"
  error.classList.remove("hidden")
  requestAnimationFrame(()=>{
    input.focus({preventScroll:true})
    input.setSelectionRange(input.value.length,input.value.length)
  })
}
;["eTitle","nTitle","cTitle"].forEach(inputId=>{
  $("#"+inputId).addEventListener("input",()=>clearTitleError(inputId))
})
function setMainWindowMaximized(isMaximized){
  const button = $("#maximizeRestoreButton")
  if(!button) return
  const label = isMaximized ? "还原窗口" : "最大化窗口"
  document.body.classList.toggle("window-maximized", isMaximized)
  button.classList.toggle("is-maximized", isMaximized)
  button.title = label
  button.setAttribute("aria-label", label)
}
async function toggleMainWindowMaximize(){
  const isMaximized = await window.electronAPI.toggleMainWindowMaximize()
  setMainWindowMaximized(isMaximized)
}
$(".title-bar").ondblclick = event=>{
  if(event.target.closest(".title-ctrl")) return
  toggleMainWindowMaximize()
}
const navItems = $$('.nav-item')
const pages = $$('.page')
navItems.forEach(item=>{
  item.onclick = async ()=>{
    const targetPage = item.dataset.page
    navItems.forEach(n=>n.classList.remove('active'))
    pages.forEach(p=>p.classList.remove('active'))
    item.classList.add('active')
    $(`#${targetPage}`).classList.add('active')
    if(targetPage === "calendar") {
      if(calendarFirstLoad){
        currentDate = new Date()
        selectedCalendarDate = getTodayStr()
        calendarFirstLoad = false
      }
      if(calendarDirty || !calendarTodoCache){
        await refreshCalendar({rebuild:true,showLoading:true})
      }
    }
  }
})
$("#sortSelector").onchange = e=>{
  sortType = e.target.value
  refreshHome()
}
function getTodayStr(){
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
let editTargetItem = null
let deleteTargetId = null
function showEditModal(item){
  clearTitleError("eTitle")
  editTargetItem = {...item}
  $("#editId").value = item.id
  $("#eTitle").value = item.text
  $("#eDesc").value = item.desc || ''
  $("#eDate").value = item.date || ""
  $("#ePrio").value = item.priority
  $("#eRemind").checked = !!item.remind
  $("#eRemindTime").value = item.remindTime || "09:00"
  $("#eCycleType").value = item.cycleType || "daily"
  $("#eDateLabel").innerText = item.isCycle ? "开始日期" : "截止日期"
  $("#eCycleTypeRow").classList.toggle("hidden", !item.isCycle)
  syncReminderTime("eRemind", "eRemindTime")
  updateReminderRule("edit")
  $("#editModal").classList.remove("hidden")
}
function hideEditModal(){$("#editModal").classList.add("hidden")}
async function submitEdit(){
  const payload = {
    id: Number($("#editId").value),
    text: $("#eTitle").value.trim(),
    desc: $("#eDesc").value.trim(),
    date: $("#eDate").value,
    priority: $("#ePrio").value,
    remind: $("#eRemind").checked,
    remindTime: $("#eRemindTime").value,
    isCycle: !!editTargetItem.isCycle,
    cycleType: editTargetItem.isCycle ? $("#eCycleType").value : ""
  }
  if(!payload.text) return showTitleError("eTitle")
  if(payload.isCycle && !payload.date) return alert("请选择循环开始日期")
  if(payload.remind && !payload.date) return alert("开启通知前请先选择日期")
  if(payload.remind && !payload.remindTime) return alert("请选择提醒时间")
  await window.electronAPI.updateTodo(payload)
  hideEditModal()
  await refreshHome()
  await refreshCalendarAfterTaskChange()
}
function showDetailModal(item){
  $("#dTitle").innerText = item.text
  $("#dDesc").innerText = item.desc || "无备注信息"
  $("#dDateLabel").innerText = item.isCycle ? "开始日期：" : "截止日期："
  $("#dDate").innerText = item.date || "无截止日期"
  const prioMap = {low:"🟢低",mid:"🟡中",high:"🔴高"}
  $("#dPrio").innerText = prioMap[item.priority]
  $("#dType").innerText = item.isCycle ? `${cycleTypeLabels[item.cycleType] || ""}循环任务` : "普通待办"
  $("#dReminder").innerText = getReminderRule(item)
  $("#detailModal").classList.remove("hidden")
}
function hideDetailModal(){$("#detailModal").classList.add("hidden")}
async function openTodoDetailById(todoId){
  const id = Number(todoId)
  if(!Number.isFinite(id)) return
  const item = (await window.electronAPI.getTodoList()).find(todo=>todo.id === id)
  if(!item) return
  ;["editModal","normalModal","cycleModal","deleteModal"].forEach(modalId=>{
    $("#"+modalId)?.classList.add("hidden")
  })
  deleteTargetId = null
  showDetailModal(item)
}
window.electronAPI.onOpenTodoDetail(openTodoDetailById)
function showDeleteModal(itemId){
  const taskId = Number(itemId)
  if(!Number.isInteger(taskId)) return
  deleteTargetId = taskId
  $("#deleteConfirmBtn").disabled = false
  $("#deleteModal").classList.remove("hidden")
}
function hideDeleteModal(){
  deleteTargetId = null
  $("#deleteConfirmBtn").disabled = false
  $("#deleteModal").classList.add("hidden")
}
async function submitDelete(){
  const taskId = deleteTargetId
  if(!Number.isInteger(taskId)) return
  const confirmButton = $("#deleteConfirmBtn")
  confirmButton.disabled = true
  try{
    await window.electronAPI.deleteTodo(taskId)
    hideDeleteModal()
    await refreshHome()
    await refreshCalendarAfterTaskChange()
  }catch(error){
    confirmButton.disabled = false
    alert("删除任务失败，请稍后重试")
  }
}
function showAddNormalModal(){
  clearTitleError("nTitle")
  $("#nDate").value = getTodayStr()
  if(!$("#nRemindTime").value) $("#nRemindTime").value = "09:00"
  syncReminderTime("nRemind", "nRemindTime")
  updateReminderRule("normal")
  $("#normalModal").classList.remove("hidden")
}
function hideNormalModal(){$("#normalModal").classList.add("hidden")}
async function submitNormal(){
  const text = $("#nTitle").value.trim()
  const desc = $("#nDesc").value.trim()
  const date = $("#nDate").value
  const prio = $("#nPrio").value
  const remind = $("#nRemind").checked
  const remindTime = $("#nRemindTime").value
  if(!text) return showTitleError("nTitle")
  if(remind && !date) return alert("开启通知前请先选择截止日期")
  if(remind && !remindTime) return alert("请选择提醒时间")
  await window.electronAPI.addTodoItem({text,desc,date,priority:prio,remind,remindTime,isCycle:false})
  hideNormalModal()
  $("#nTitle").value=""
  $("#nDesc").value=""
  await refreshHome()
  await refreshCalendarAfterTaskChange()
}
function showAddCycleModal(){
  clearTitleError("cTitle")
  $("#cDate").value = getTodayStr()
  if(!$("#cTime").value) $("#cTime").value = "09:00"
  syncReminderTime("cRemind", "cTime")
  updateReminderRule("cycle")
  $("#cycleModal").classList.remove("hidden")
}
function hideCycleModal(){$("#cycleModal").classList.add("hidden")}
async function submitCycle(){
  const text = $("#cTitle").value.trim()
  const cycleType = $("#cCycleType").value
  const date = $("#cDate").value
  const remindTime = $("#cTime").value
  const remind = $("#cRemind").checked
  if(!text) return showTitleError("cTitle")
  if(!date) return alert("请选择循环开始日期")
  if(remind && !remindTime) return alert("请选择提醒时间")
  await window.electronAPI.addTodoItem({
    text,desc:"",date,priority:"mid",remind,isCycle:true,cycleType,remindTime
  })
  hideCycleModal()
  $("#cTitle").value=""
  await refreshHome()
  await refreshCalendarAfterTaskChange()
}
function syncReminderTime(checkboxId, timeInputId){
  const checkbox = $("#"+checkboxId)
  const input = $("#"+timeInputId)
  input.disabled = !checkbox.checked
}
function getReminderRule(item){
  if(!item || !item.remind) return "开启后会按任务日期和提醒时间显示任务提醒。"
  const time = item.remindTime || "09:00"
  if(!item.isCycle){
    return `${item.date || "截止日期"} 当天 ${time} 提醒一次；不会提前一天或每天重复。`
  }
  const cycleRule = {
    daily:"每天",
    weekly:"每周同一星期",
    monthly:"每月同一日号"
  }[item.cycleType] || "每个循环日"
  return `从 ${item.date || "开始日期"} 起，${cycleRule} ${time} 提醒一次。`
}
function updateReminderRule(form){
  const fields = {
    edit:{remind:"eRemind",date:"eDate",time:"eRemindTime",cycle:"eCycleType",target:"eReminderRule",isCycle:!!editTargetItem?.isCycle},
    normal:{remind:"nRemind",date:"nDate",time:"nRemindTime",target:"nReminderRule",isCycle:false},
    cycle:{remind:"cRemind",date:"cDate",time:"cTime",cycle:"cCycleType",target:"cReminderRule",isCycle:true}
  }[form]
  if(!fields) return
  $("#"+fields.target).innerText = getReminderRule({
    remind:$("#"+fields.remind).checked,
    date:$("#"+fields.date).value,
    remindTime:$("#"+fields.time).value,
    isCycle:fields.isCycle,
    cycleType:fields.cycle ? $("#"+fields.cycle).value : ""
  })
}
function isOverdue(item){
  if(!item || item.isCycle || !item.date) return false
  const today = new Date()
  today.setHours(0,0,0,0)
  const t = recurrence.parseLocalDate(item.date)
  if(!t) return false
  return t < today
}
function isFutureOrToday(item){
  if(!item || item.isCycle || !item.date) return false
  const today = new Date()
  today.setHours(0,0,0,0)
  const t = recurrence.parseLocalDate(item.date)
  if(!t) return false
  return t >= today
}
function sortTodoList(list){
  const prioMap = {"high":3,"mid":2,"low":1}
  const unfinished = list.filter(i=>!i.archived)
  const finished = list.filter(i=>i.archived)
  switch(sortType){
    case "date-asc":
      unfinished.sort((a,b)=>new Date(a.date||0)-new Date(b.date||0))
      break
    case "date-desc":
      unfinished.sort((a,b)=>new Date(b.date||0)-new Date(a.date||0))
      break
    case "prio-high":
      unfinished.sort((a,b)=>prioMap[b.priority]-prioMap[a.priority])
      break
    case "prio-low":
      unfinished.sort((a,b)=>prioMap[a.priority]-prioMap[b.priority])
      break
  }
  return [...unfinished,...finished]
}
async function refreshHome(){
  const now = new Date()
  const weekArr=["周日","周一","周二","周三","周四","周五","周六"]
  const pad = n=>String(n).padStart(2,'0')
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  $("#nowDate").innerText = `${now.getFullYear()}/${now.getMonth()+1}/${now.getDate()} ${weekArr[now.getDay()]} ${timeStr}`
  const rawList = await window.electronAPI.getTodoList()
  // 已"不再提醒"的逾期任务从待办列表移除；可在日历中点"添加至待办"重新放回
  const visibleList = rawList.filter(i=> !(isOverdue(i) && i.muteRemind && !i.archived))
  const list = sortTodoList(visibleList)
  const dom = $("#taskList")
  dom.innerHTML=""
  list.forEach(item=>{
    const overdue = isOverdue(item)
    const priority = ["high","mid","low"].includes(item.priority) ? item.priority : "mid"
    let cardClass = "item-card glass prio-"+priority
    if(overdue) cardClass += " overdue"
    if(item.archived) cardClass += " item-done"
    if(item.isCycle) cardClass += " cycle-item"
    const subText = item.isCycle
      ? `${cycleTypeLabels[item.cycleType] || "循环"} · ${item.date} 起 · ${item.remindTime || "09:00"}`
      : `${item.date || "无截止日期"}｜${item.desc || ""}`
    const itemId = safeDataId(item.id)
    const card = document.createElement("div")
    card.className = cardClass
    card.onclick = (e)=>{
      if(!e.target.classList.contains("more-btn")){
        showDetailModal(item)
      }
    }
    card.innerHTML = `
      <div class="item-left">
        <div class="item-title">${escapeHtml(item.text)} ${item.remind?"🔔":""}</div>
        <div class="item-desc-text">${escapeHtml(subText)}</div>
      </div>
      <div class="item-ctrl">
        <div class="more-btn" data-id="${itemId}">⋮</div>
      </div>
    `
    const btn = card.querySelector('.more-btn')
    btn.onclick = (e)=>{
      e.stopPropagation()
      showFixedDrop(e,item)
    }
    dom.appendChild(card)
  })
}
function hideGlobalDrop(){
  $("#globalDrop").classList.add('hidden')
  $("#globalDrop").dataset.forId = ""
  $("#globalDropMask").classList.add('hidden')
  // 移除三点按钮的"菜单已打开"高亮
  document.querySelectorAll('.more-btn.menu-open').forEach(b=>b.classList.remove('menu-open'))
}
function showFixedDrop(evt,item){
  evt.stopPropagation()
  const menuDom = $("#globalDrop")
  const itemId = safeDataId(item.id)
  if(!itemId) return
  // 再次点击同一个三点按钮，关闭菜单
  if(!menuDom.classList.contains('hidden') && menuDom.dataset.forId === itemId){
    hideGlobalDrop()
    return
  }
  menuDom.dataset.forId = itemId
  // 给当前三点按钮加高亮（先清掉其它按钮的）
  document.querySelectorAll('.more-btn.menu-open').forEach(b=>b.classList.remove('menu-open'))
  if(evt.target && evt.target.classList.contains('more-btn')) evt.target.classList.add('menu-open')
  const inCalendar = $("#calendar").classList.contains("active")
  let menuHtml = ""
  if(item.archived){
    menuHtml += `<div class="drop-item" data-op="restore" data-id="${itemId}">恢复任务</div>`
    menuHtml += `<div class="drop-item" data-op="del" data-id="${itemId}">删除</div>`
  }else{
    if(!item.isCycle){
      menuHtml += `<div class="drop-item" data-op="edit" data-id="${itemId}">编辑</div>`
      menuHtml += `<div class="drop-item" data-op="done" data-id="${itemId}">标记完成</div>`
      if(isOverdue(item)){
        if(inCalendar){
          // 日历页：在待办中(muteRemind=false)显示"已添加至待办"且不可点；已移除(muteRemind=true)显示可点的"添加至待办"
          if(item.muteRemind){
            menuHtml += `<div class="drop-item" data-op="addTodo" data-id="${itemId}">添加至待办</div>`
          }else{
            menuHtml += `<div class="drop-item" data-op="added" data-id="${itemId}" style="opacity:0.55;cursor:default">已添加至待办</div>`
          }
        }else{
          menuHtml += `<div class="drop-item" data-op="mute" data-id="${itemId}">不再提醒</div>`
        }
      }
      menuHtml += `<div class="drop-item" data-op="del" data-id="${itemId}">删除</div>`
    }else{
      menuHtml += `<div class="drop-item" data-op="edit" data-id="${itemId}">编辑</div>`
      menuHtml += `<div class="drop-item" data-op="del" data-id="${itemId}">删除</div>`
    }
  }
  menuDom.innerHTML = menuHtml
  const rect = evt.target.getBoundingClientRect()
  // 先显示遮罩和菜单以测量尺寸
  $("#globalDropMask").classList.remove('hidden')
  menuDom.style.left = '0px'
  menuDom.style.top = '0px'
  menuDom.classList.remove('hidden')
  const menuH = menuDom.offsetHeight
  const menuW = menuDom.offsetWidth
  const vw = window.innerWidth
  const vh = window.innerHeight
  // 水平定位：默认在按钮左侧，溢出则放右侧
  let leftPos = rect.left - menuW - 6
  if(leftPos < 10) leftPos = rect.right + 6
  if(leftPos + menuW > vw - 6) leftPos = vw - menuW - 6
  if(leftPos < 6) leftPos = 6
  // 垂直定位：默认在按钮下方，溢出则放上方
  let topPos = rect.bottom + 6
  if(topPos + menuH > vh - 6) topPos = rect.top - menuH - 6
  if(topPos < 6) topPos = 6
  menuDom.style.left = `${leftPos}px`
  menuDom.style.top = `${topPos}px`
  $$('.drop-item').forEach(el=>{
    el.onclick = async (ev)=>{
      const op = el.dataset.op
      const tid = Number(el.dataset.id)
      if(op === 'added'){ ev.stopPropagation(); return }
      hideGlobalDrop()
      if(op === 'edit'){
        const all = await window.electronAPI.getTodoList()
        const target = all.find(x=>x.id === tid)
        showEditModal(target)
      }else if(op === 'done'){
        await window.electronAPI.archiveTodo(tid)
        await refreshHome()
        await refreshCalendarAfterTaskChange()
      }else if(op === 'restore'){
        await window.electronAPI.unarchiveTodo(tid)
        await refreshHome()
        await refreshCalendarAfterTaskChange()
      }else if(op === 'mute'){
        await window.electronAPI.muteTodoRemind(tid)
        await refreshHome()
        await refreshCalendarAfterTaskChange()
      }else if(op === 'addTodo'){
        await window.electronAPI.addToToday(tid)
        await refreshHome()
        await refreshCalendarAfterTaskChange()
      }else if(op === 'del'){
        showDeleteModal(tid)
      }
    }
  })
}
document.body.onclick = hideGlobalDrop
// 点击三点菜单的透明遮罩关闭菜单
$("#globalDropMask").addEventListener('click', e=>{
  e.stopPropagation()
  hideGlobalDrop()
})
// 点击遮罩关闭任务详情弹窗
$("#detailModal").addEventListener('click', e=>{
  if(e.target.id === 'detailModal') hideDetailModal()
})
$("#deleteModal").addEventListener('click', e=>{
  if(e.target.id === 'deleteModal') hideDeleteModal()
})
// 回到顶部按钮：监听待办列表与日历列表滚动
const backTopBtn = $("#backTopBtn")
const homeListWrap = $("#taskList")
const calendarScroll = $("#calendarScroll")
function updateBackTopVisible(){
  const el = backTopBtn._currentTarget
  if(!el){ backTopBtn.classList.remove('show'); return }
  if(el.scrollTop > 120) backTopBtn.classList.add('show')
  else backTopBtn.classList.remove('show')
}
homeListWrap.addEventListener('scroll', ()=>{
  backTopBtn._currentTarget = homeListWrap
  updateBackTopVisible()
})
calendarScroll.addEventListener('scroll', ()=>{
  backTopBtn._currentTarget = calendarScroll
  updateBackTopVisible()
})
backTopBtn.addEventListener('click', ()=>{
  const el = backTopBtn._currentTarget
  if(el) el.scrollTo({top:0, behavior:'smooth'})
})
async function openFloat(){
  await window.electronAPI.toggleFloatWin()
}
function markCalendarDirty(){
  calendarDirty = true
  calendarTodoCache = null
}
function updateCalendarSelection(){
  $$("#calendarBody .calendar-day.active-day").forEach(day=>day.classList.remove("active-day"))
  const selectedDay = $(`#calendarBody .calendar-day[data-date="${selectedCalendarDate}"]`)
  if(selectedDay) selectedDay.classList.add("active-day")
}
function selectCalendarDate(dateStr){
  if(selectedCalendarDate === dateStr) return
  selectedCalendarDate = dateStr
  if(!calendarTodoCache){
    calendarDirty = true
    refreshCalendar({rebuild:true,showLoading:true})
    return
  }
  updateCalendarSelection()
  renderDayTaskPanel(dateStr,calendarTodoCache)
}
async function refreshCalendar({rebuild=false,showLoading=false}={}){
  const needsTodoLoad = calendarDirty || !calendarTodoCache
  if(showLoading && (rebuild || needsTodoLoad)) prefillDayTaskBox(selectedCalendarDate)
  if(needsTodoLoad){
    calendarTodoCache = await window.electronAPI.getTodoList()
    calendarDirty = false
  }
  if(rebuild || needsTodoLoad) renderCalendar(calendarTodoCache)
  renderDayTaskPanel(selectedCalendarDate,calendarTodoCache)
}
async function refreshCalendarAfterTaskChange(){
  markCalendarDirty()
  if(!$("#calendar").classList.contains("active")) return
  await refreshCalendar({rebuild:true,showLoading:true})
}
function renderCalendar(allTodo = calendarTodoCache || []){
  const savedScroll = $("#calendarScroll").scrollTop
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  $("#monthTitle").innerText = `${year}年${month+1}月`
  const weekStartMon = !!appConfig.weekStartMon
  const weekArr = weekStartMon ? ["一","二","三","四","五","六","日"] : ["日","一","二","三","四","五","六"]
  const weekRowDom = $("#weekRow")
  weekRowDom.innerHTML=""
  weekArr.forEach(w=>{
    const d = document.createElement("div")
    d.className="week-title";d.innerText=w;weekRowDom.appendChild(d)
  })
  const first = new Date(year,month,1)
  const last = new Date(year,month+1,0)
  let startWeek = first.getDay()
  if(weekStartMon){
    startWeek = startWeek===0 ? 6 : startWeek-1
  }
  const totalDay = last.getDate()
  const body = $("#calendarBody")
  body.innerHTML = ""
  for(let i=0;i<startWeek;i++){
    const empty = document.createElement("div")
    empty.className = "calendar-day"
    empty.innerHTML = `<div class="day-num"></div><div class="dot-placeholder"></div>`
    body.appendChild(empty)
  }
  for(let d=1;d<=totalDay;d++){
    const dayDom = document.createElement("div")
    dayDom.className = "calendar-day"
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    dayDom.dataset.date = dateStr
    dayDom.innerHTML = `<div class="day-num">${d}</div><div class="dot-placeholder"></div>`
    const hasTask = allTodo.some(t=>t.isCycle ? recurrence.occursOnDate(t,dateStr) : t.date === dateStr)
    if(hasTask) dayDom.classList.add("has-todo")
    if(selectedCalendarDate === dateStr) dayDom.classList.add("active-day")
    dayDom.onclick = ()=>selectCalendarDate(dateStr)
    body.appendChild(dayDom)
  }
  $("#calendarScroll").scrollTop = savedScroll
}
// 切换日期/月份前预占位，避免当日任务在顶部闪一下
function prefillDayTaskBox(dateStr){
  const box = $("#dayTaskBox")
  const listDom = $("#dayTaskList")
  box.classList.remove("hidden")
  // 撑住当前内容高度，防止 prefill 缩短内容导致外层 scrollTop 被夹断
  const curH = listDom.offsetHeight
  listDom.style.minHeight = curH + 'px'
  listDom.innerHTML = `<p style="color:#94a3b8">加载中…</p>`
}
async function renderDayTaskPanel(dateStr,allTodo){
  const box = $("#dayTaskBox")
  const listDom = $("#dayTaskList")
  box.classList.remove("hidden")
  listDom.innerHTML = ""
  listDom.style.minHeight = ''  // 清除 prefill 撑高的占位
  const dayList = allTodo.filter(item=>item.isCycle ? recurrence.occursOnDate(item,dateStr) : item.date === dateStr)
  if(!dayList.length){
    listDom.innerHTML = "<p>今日暂无任务</p>"
    return
  }
  dayList.forEach(item=>{
    const overdue = isOverdue(item)
    const futureToday = isFutureOrToday(item)
    let statusText = ""
    const prioColorMap = {high:"#ef4444",mid:"#f59e0b",low:"#10b981"}
    let rowStyle = `border-left-color:${prioColorMap[item.priority]||"#9ca3af"};`
    let rowClass = "day-task-row glass"
    const itemId = safeDataId(item.id)
    if(item.archived){
      rowClass += " item-done"
      statusText = `<span class="tag-done">已完成</span>`
    }else if(item.isCycle){
      statusText = `<span class="tag-normal">${cycleTypeLabels[item.cycleType] || "循环"}</span>`
    }else if(overdue){
      rowClass += " overdue"
      if(item.muteRemind){
        statusText = `<span class="tag-overdue">逾期</span>`
      }else{
        statusText = `<span class="tag-overdue">逾期</span><span class="tag-done">已添加至待办</span>`
      }
    }else if(futureToday){
      statusText = `<span class="tag-normal">未完成</span>`
    }
    const row = document.createElement("div")
    row.className = rowClass
    row.style.cssText = rowStyle
    row.innerHTML = `
        <div class="item-left">
        <div class="item-title">${escapeHtml(item.text)} ${item.remind?"🔔":""} ${statusText}</div>
        <div class="item-desc-text">${escapeHtml(item.desc || "无备注")}</div>
      </div>
      <div class="item-ctrl">
        <div class="more-btn" data-id="${itemId}">⋮</div>
      </div>
    `
    const moreBtn = row.querySelector('.more-btn')
    moreBtn.onclick = (e) => {
      e.stopPropagation()
      showFixedDrop(e, item)
    }
    row.onclick = (e) => {
      if (!e.target.classList.contains('more-btn')) {
        showDetailModal(item)
      }
    }
    listDom.appendChild(row)
  })
}
$("#prevMonth").onclick = async () => {
  currentDate = recurrence.shiftMonthToStart(currentDate, -1)
  selectedCalendarDate = firstDayStrOf(currentDate)
  await refreshCalendar({rebuild:true,showLoading:calendarDirty || !calendarTodoCache})
}
$("#nextMonth").onclick = async () => {
  currentDate = recurrence.shiftMonthToStart(currentDate, 1)
  selectedCalendarDate = firstDayStrOf(currentDate)
  await refreshCalendar({rebuild:true,showLoading:calendarDirty || !calendarTodoCache})
}
function firstDayStrOf(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`
}
function renderDataLocation(location){
  const input = $("#dataLocationPath")
  input.value = location?.directory || ""
  input.title = input.value
}
async function changeDataLocation(){
  const button = $("#changeDataLocationBtn")
  button.disabled = true
  try{
    const result = await window.electronAPI.chooseDataLocation()
    if(result.cancelled) return
    renderDataLocation(result)
    if(result.cleanupPending?.length){
      alert(`数据位置已切换，但旧位置仍保留：${result.cleanupPending.join("、")}`)
    }else if(!result.unchanged){
      alert("数据存储位置已切换")
    }
  }catch(error){
    alert(`切换数据存储位置失败：${error.message || "请检查目标文件夹"}`)
  }finally{
    button.disabled = false
  }
}
async function initApp(){
  const appInfo = await window.electronAPI.getAppInfo()
  $("#appVersion").innerText = `v${appInfo.version}`
  const cfgRes = await window.electronAPI.getFloatConfig()
  appConfig = cfgRes.config
  $("#weekStartSel").value = String(appConfig.weekStartMon)
  $("#autoStartCheck").checked = !!appConfig.autoStart
  renderDataLocation(await window.electronAPI.getDataLocation())
  $("#changeDataLocationBtn").onclick = changeDataLocation
  $("#weekStartSel").onchange = async e=>{
    appConfig.weekStartMon = e.target.value === "true"
    await window.electronAPI.setGlobalConfig({weekStartMon: appConfig.weekStartMon})
    if($("#calendar").classList.contains("active")){
      await refreshCalendar({rebuild:true,showLoading:false})
    }
  }
  $("#autoStartCheck").onchange = async e=>{
    appConfig.autoStart = e.target.checked
    await window.electronAPI.setGlobalConfig({autoStart: appConfig.autoStart})
  }
  const reminderForms = [
    {checkbox:"eRemind",time:"eRemindTime",form:"edit"},
    {checkbox:"nRemind",time:"nRemindTime",form:"normal"},
    {checkbox:"cRemind",time:"cTime",form:"cycle"}
  ]
  reminderForms.forEach(({checkbox,time,form})=>{
    $("#"+checkbox).onchange = ()=>{
      syncReminderTime(checkbox,time)
      updateReminderRule(form)
    }
    syncReminderTime(checkbox,time)
  })
  ;[["eDate","edit"],["eRemindTime","edit"],["eCycleType","edit"],["nDate","normal"],["nRemindTime","normal"],["cDate","cycle"],["cTime","cycle"],["cCycleType","cycle"]].forEach(([id,form])=>{
    $("#"+id).onchange = ()=>updateReminderRule(form)
  })
  refreshHome()
}
window.onload = ()=>{
  initApp()
  startClock()
  scheduleHourlyRefresh()
}
// 每秒更新顶部时间显示
function startClock(){
  updateNowTime()
  setInterval(updateNowTime, 1000)
}
function updateNowTime(){
  const now = new Date()
  const weekArr=["周日","周一","周二","周三","周四","周五","周六"]
  const pad = n=>String(n).padStart(2,'0')
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  $("#nowDate").innerText = `${now.getFullYear()}/${now.getMonth()+1}/${now.getDate()} ${weekArr[now.getDay()]} ${timeStr}`
}
// 整点刷新：在下一个整点触发一次数据刷新，之后每小时触发一次
function scheduleHourlyRefresh(){
  const now = new Date()
  const next = new Date(now)
  next.setHours(now.getHours()+1, 0, 0, 500) // 整点 + 0.5s
  const delay = next.getTime() - now.getTime()
  setTimeout(()=>{
    refreshAll()
    setInterval(refreshAll, 60*60*1000)
  }, delay)
}
// 刷新当前激活页（待办/日历）
async function refreshAll(){
  await refreshHome()
  if($("#calendar").classList.contains("active")){
    await refreshCalendar({rebuild:calendarDirty || !calendarTodoCache,showLoading:false})
  }
}
