
var activeDoc;

chrome.runtime.onInstalled.addListener(function() {
  chrome.contextMenus.create({
    id: "read-selection",
    title: chrome.i18n.getMessage("context_read_selection"),
    contexts: ["selection"]
  });
})

chrome.contextMenus.onClicked.addListener(function(info, tab) {
  if (info.menuItemId == "read-selection")
    stop().then(function() {
      playText(info.selectionText, function(err) {
        if (err) console.error(err);
      })
    })
})

chrome.commands.onCommand.addListener(function(command) {
  if (command == "play") {
    getPlaybackState()
      .then(function(state) {
        if (state == "PLAYING") return pause();
        else if (state == "STOPPED" || state == "PAUSED") return play();
      })
  }
  else if (command == "stop") stop();
  else if (command == "forward") forward();
  else if (command == "rewind") rewind();
})

function playText(text, onEnd) {
  if (!activeDoc) {
    activeDoc = new Doc(new SimpleSource(text.split(/(?:\r?\n){2,}/)), function(err) {
      if (!err) closeDoc();
      if (typeof onEnd == "function") onEnd(err);
    })
  }
  return activeDoc.play()
    .catch(function(err) {closeDoc(); throw err})
}

function play(onEnd) {
  if (!activeDoc) {
    activeDoc = new Doc(new TabSource(), function(err) {
      if (!err) closeDoc();
      if (typeof onEnd == "function") onEnd(err);
    })
  }
  return activeDoc.play()
    .catch(function(err) {closeDoc(); throw err})
}

function stop() {
  if (activeDoc) {
    return activeDoc.stop()
      .then(closeDoc)
      .catch(function(err) {closeDoc(); throw err})
  }
  else return Promise.resolve();
}

function pause() {
  if (activeDoc) return activeDoc.pause();
  else return Promise.resolve();
}

function getPlaybackState() {
  if (activeDoc) return activeDoc.getState();
  else return Promise.resolve("STOPPED");
}

function getActiveSpeech() {
  if (activeDoc) return activeDoc.getActiveSpeech();
  else return Promise.resolve(null);
}

function closeDoc() {
  if (activeDoc) {
    activeDoc.close();
    activeDoc = null;
  }
}

function forward() {
  if (activeDoc) return activeDoc.forward();
  else return Promise.reject(new Error("Can't forward, not active"));
}

function rewind() {
  if (activeDoc) return activeDoc.rewind();
  else return Promise.reject(new Error("Can't rewind, not active"));
}

function reportIssue(url, comment) {
  return getSettings()
    .then(function(settings) {
      if (url) settings.url = url;
      settings.browser = config.browser;
      return ajaxPost(config.serviceUrl + "/read-aloud/report-issue", {
        url: JSON.stringify(settings),
        comment: comment
      })
    })
}
