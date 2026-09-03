let words = [];
      let idx = 0;
      async function loadWords() {
        const res = await fetch("./wordlist.json");
        words = await res.json();
        showWord();
      }
      function showWord() {
        if (!words.length) return;
        const item = words[idx % words.length];
        document.getElementById("w").innerText = item.word;
        document.getElementById("e").innerText = item.explain;
      }
      function nextWord() {
        idx++;
        showWord();
      }
      const floatBody = document.querySelector(".body");
      let isDragging = false;
      let lastPoint = null;
      let dragDistance = 0;

      floatBody.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || event.target.closest(".no-close-dblclick")) return;
        isDragging = true;
        dragDistance = 0;
        lastPoint = { x: event.screenX, y: event.screenY };
        floatBody.setPointerCapture(event.pointerId);
      });

      floatBody.addEventListener("pointermove", async (event) => {
        if (!isDragging || !lastPoint) return;
        const deltaX = event.screenX - lastPoint.x;
        const deltaY = event.screenY - lastPoint.y;
        if (deltaX === 0 && deltaY === 0) return;
        dragDistance += Math.abs(deltaX) + Math.abs(deltaY);
        lastPoint = { x: event.screenX, y: event.screenY };
        await window.electronAPI.moveFloatWin(deltaX, deltaY);
      });

      async function stopDragging(event) {
        if (!isDragging) return;
        isDragging = false;
        lastPoint = null;
        if (floatBody.hasPointerCapture(event.pointerId)) {
          floatBody.releasePointerCapture(event.pointerId);
        }
        await window.electronAPI.saveFloatWinPosition();
      }

      floatBody.addEventListener("pointerup", stopDragging);
      floatBody.addEventListener("pointercancel", stopDragging);
      floatBody.addEventListener("dblclick", (event) => {
        if (event.target.closest(".no-close-dblclick")) return;
        if (dragDistance > 4) return;
        window.electronAPI.closeFloatWin();
      });
      loadWords();
