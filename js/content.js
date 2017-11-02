
var readAloud = {
  paraSplitter: /(?:\s*\r?\n\s*){2,}/
};

function connect(name) {
  if (!window.docReady) window.docReady = makeDoc();
  window.docReady.then(function(doc) {startService(name, doc)});
}


function startService(name, doc) {
  var port = chrome.runtime.connect({name: name});
  port.onMessage.addListener(dispatch.bind(null, {
    raGetInfo: getInfo,
    raGetCurrentIndex: getCurrentIndex,
    raGetTexts: getTexts,
  }))

  function dispatch(handlers, message) {
    var request = message.request;
    if (handlers[request.method]) {
      var result = handlers[request.method](request);
      Promise.resolve(result).then(function(response) {
        port.postMessage({id: message.id, response: response});
      });
    }
  }

  function getInfo(request) {
    var lang = document.documentElement.lang || $("html").attr("xml:lang");
    if (lang == "en") lang = null;    //foreign language pages often erronenously declare lang="en"
    return {
      isPdf: doc.isPdf,
      canSeek: doc.canSeek,
      url: location.href,
      title: document.title,
      lang: lang
    }
  }

  function getCurrentIndex(request) {
    if (getSelectedText()) return -100;
    else return doc.getCurrentIndex();
  }

  function getTexts(request) {
    if (request.index < 0) {
      if (request.index == -100) return getSelectedText().split(readAloud.paraSplitter);
      else return null;
    }
    else {
      return Promise.resolve(doc.getTexts(request.index))
        .then(function(texts) {
          if (texts) {
            texts = texts.map(removeLinks);
            console.log(texts.join("\n\n"));
          }
          return texts;
        })
    }
  }

  function getSelectedText() {
    return window.getSelection().toString().trim();
  }

  function removeLinks(text) {
    return text.replace(/https?:\/\/\S+/g, "this URL.");
  }
}


function makeDoc() {
  return domReady()
    .then(createDoc)
    .then(function(doc) {
      return Promise.resolve(doc.ready).then(function() {return doc});
    })

  function domReady() {
    return new Promise(function(fulfill) {
      $(fulfill);
    })
  }

  function createDoc() {
    if (location.hostname == "docs.google.com") {
      if ($(".kix-appview-editor").length) return new GoogleDoc();
      else if ($(".drive-viewer-paginated-scrollable").length) return new GDriveDoc();
      else return new HtmlDoc();
    }
    else if (location.hostname == "drive.google.com") return new GDriveDoc();
    else if (/^read\.amazon\./.test(location.hostname)) return new KindleBook();
    else if (location.hostname == "www.quora.com") return new QuoraPage();
    else if (location.hostname == "www.khanacademy.org") return new KhanAcademy();
    else if (location.pathname.match(/\.pdf$/)) return new PdfDoc(location.href);
    else if ($("embed[type='application/pdf']").length) return new PdfDoc($("embed[type='application/pdf']").attr("src"));
    else return new HtmlDoc();
  }
}


function GoogleDoc() {
  var viewport = $(".kix-appview-editor").get(0);
  var pages = $(".kix-page");

  this.getCurrentIndex = function() {
    for (var i=0; i<pages.length; i++) if (pages.eq(i).position().top > viewport.scrollTop+$(viewport).height()/2) break;
    return i-1;
  }

  this.getTexts = function(index) {
    var page = pages.get(index);
    if (page) {
      viewport.scrollTop = $(page).position().top;
      return tryGetTexts(getTexts.bind(page), 2000);
    }
    else return null;
  }

  function getTexts() {
    return $(".kix-paragraphrenderer", this).get()
      .map(function(elem) {return elem.innerText.trim()})
      .filter(isNotEmpty);
  }
}


function GDriveDoc() {
  var viewport = $(".drive-viewer-paginated-scrollable").get(0);
  var pages = $(".drive-viewer-paginated-page");

  this.getCurrentIndex = function() {
    for (var i=0; i<pages.length; i++) if (pages.eq(i).position().top > viewport.scrollTop+$(viewport).height()/2) break;
    return i-1;
  }

  this.getTexts = function(index) {
    var page = pages.get(index);
    if (page) {
      viewport.scrollTop = $(page).position().top;
      return tryGetTexts(getTexts.bind(page), 3000);
    }
    else return null;
  }

  function getTexts() {
    var texts = $("p", this).get()
      .map(function(elem) {return elem.innerText.trim()})
      .filter(isNotEmpty);
    return fixParagraphs(texts);
  }
}


function KindleBook() {
  var mainDoc = document.getElementById("KindleReaderIFrame").contentDocument;
  var btnNext = mainDoc.getElementById("kindleReader_pageTurnAreaRight");
  var btnPrev = mainDoc.getElementById("kindleReader_pageTurnAreaLeft");
  var contentFrames = [
    mainDoc.getElementById("column_0_frame_0"),
    mainDoc.getElementById("column_0_frame_1"),
    mainDoc.getElementById("column_1_frame_0"),
    mainDoc.getElementById("column_1_frame_1")
  ];
  var currentIndex = 0;
  var lastText;

  this.getCurrentIndex = function() {
    return currentIndex = 0;
  }

  this.getTexts = function(index) {
    for (; currentIndex<index; currentIndex++) $(btnNext).click();
    for (; currentIndex>index; currentIndex--) $(btnPrev).click();
    return tryGetTexts(getTexts, 4000);
  }

  function getTexts() {
    var texts = [];
    contentFrames.filter(function(frame) {
      return frame.style.visibility != "hidden";
    })
    .forEach(function(frame) {
      var frameHeight = $(frame).height();
      $("h1, h2, h3, h4, h5, h6, .was-a-p", frame.contentDocument).each(function() {
        var top = $(this).offset().top;
        var bottom = top + $(this).height();
        if (top >= 0 && top < frameHeight) texts.push($(this).text());
      })
    })
    var out = [];
    for (var i=0; i<texts.length; i++) {
      if (texts[i] != (out.length ? out[out.length-1] : lastText)) out.push(texts[i]);
    }
    lastText = out[out.length-1];
    return out;
  }
}


function PdfDoc(url) {
  var pdf;
  this.isPdf = true;
  this.canSeek = true;

  this.getCurrentIndex = function() {
    return 0;
  }

  this.getTexts = function(index) {
    if (/^file:/.test(url)) {
      showUploadDialog();
      return Promise.resolve(null);
    }
    return ready().then(function() {
      if (index < pdf.numPages) return pdf.getPage(index+1).then(getPageTexts);
      else return null;
    })
  }

  function getPageTexts(page) {
    return page.getTextContent()
      .then(function(content) {
        var lines = [];
        for (var i=0; i<content.items.length; i++) {
          if (lines.length == 0 || i > 0 && content.items[i-1].transform[5] != content.items[i].transform[5]) lines.push("");
          lines[lines.length-1] += content.items[i].str;
        }
        return lines.map(function(line) {return line.trim()});
      })
      .then(fixParagraphs)
  }

  function ready() {
    if (pdf) return Promise.resolve();
    else {
      PDFJS.workerSrc = chrome.runtime.getURL("/js/pdf.worker.js");
      return PDFJS.getDocument(url).promise.then(function(result) {pdf = result});
    }
  }

  function showUploadDialog() {
    if ($(".pdf-upload-dialog:visible").length) return;

    var div = $("<div>")
      .addClass("pdf-upload-dialog");
    $("<p>")
      .text(formatMessage({code: "uploadpdf_message1", extension_name: chrome.i18n.getMessage("extension_short_name")}))
      .css("color", "blue")
      .appendTo(div);
    $("<p>")
      .text(formatMessage({code: "uploadpdf_message2", extension_name: chrome.i18n.getMessage("extension_short_name")}))
      .appendTo(div);
    var form = $("<form>")
      .attr("action", "https://support2.lsdsoftware.com/dropmeafile-readaloud/upload")
      .attr("method", "POST")
      .attr("enctype", "multipart/form-data")
      .on("submit", function() {
        btnSubmit.prop("disabled", true);
      })
      .appendTo(div);
    $("<input>")
      .attr("type", "file")
      .attr("name", "fileToUpload")
      .attr("accept", "application/pdf")
      .on("change", function() {
        btnSubmit.prop("disabled", !$(this).val())
      })
      .appendTo(form);
    $("<br>")
      .appendTo(form);
    $("<br>")
      .appendTo(form);
    var btnSubmit = $("<input>")
      .attr("type", "submit")
      .attr("value", chrome.i18n.getMessage("uploadpdf_submit_button"))
      .prop("disabled", true)
      .appendTo(form);

    div.appendTo(document.body)
      .dialog({
        title: chrome.i18n.getMessage("extension_short_name"),
        width: 400,
        modal: true
      })
  }

  function formatMessage(msg) {
    var message = chrome.i18n.getMessage(msg.code);
    if (message) message = message.replace(/{(\w+)}/g, function(m, p1) {return msg[p1]});
    return message;
  }
}


function QuoraPage() {
  this.getCurrentIndex = function() {
    return 0;
  }

  this.getTexts = function(index) {
    if (index == 0) return parse();
    else return null;
  }

  function parse() {
    var texts = [];
    var elem = $(".QuestionArea .question_qtext").get(0);
    if (elem) texts.push(elem.innerText);
    $(".AnswerBase")
      .each(function() {
        elem = $(this).find(".feed_item_answer_user .user").get(0);
        if (elem) texts.push("Answer by " + elem.innerText);
        elem = $(this).find(".rendered_qtext").get(0);
        if (elem) texts.push.apply(texts, elem.innerText.split(readAloud.paraSplitter));
        elem = $(this).find(".AnswerFooter").get(0);
        if (elem) texts.push(elem.innerText);
      })
    return texts;
  }
}


function KhanAcademy() {
  this.getCurrentIndex = function() {
    return 0;
  }

  this.getTexts = function(index) {
    if (index == 0) return parse();
    else return null;
  }

  function parse() {
    return $("h1:first")
      .add($("> :not(ul, ol), > ul > li, > ol > li", ".paragraph:not(.paragraph .paragraph)"))
      .get()
      .map(function(elem) {
        var text = elem.innerText.trim();
        if ($(elem).is("li")) return ($(elem).index() + 1) + ". " + text;
        else return text;
      })
  }
}


function HtmlDoc() {
  var headingTags = "H1, H2, H3, H4, H5, H6";
  var listTags = "ol, ul, dl, dir";
  var frameTags = "frame, iframe";
  var ignoredTags = "fieldset, input, select, textarea, button, datalist, output, audio, video, colgroup, del, dialog, embed, label, map, menu, nav, noframes, noscript, object, ruby, s, script, strike, style";

  this.getCurrentIndex = function() {
    return 0;
  }

  this.getTexts = function(index) {
    if (index == 0) return parse();
    else return null;
  }

  function parse() {
    //find blocks containing text
    var toRead = [];
    var walk = function() {
      if (isIgnore(this));
      else if ($(this).is(frameTags)) try {walk.call(this.contentDocument.body)} catch(err) {}
      else if (isRead(this)) toRead.push(this);
      else if (!$(this).is(listTags) || $(this).siblings("p").length) $(this).children().each(walk);
    };
    var start = new Date().getTime();
    walk.call(document.body);
    console.log("Walked DOM in", new Date().getTime()-start, "ms");

    //trim
    var head = {level: 99, index: 0};
    for (var i=0; i<toRead.length; i++) {
      var level = getHeadingLevel(toRead[i]);
      if (level && level < head.level) head = {level: level, index: i};
    }

    var texts = toRead.map(function(elem) {
      return (elem.innerText || elem.textContent).trim();
    })
    var tail = null;
    for (var i=texts.length-2; i>=0 && tail==null; i--) {
      var dist = getGaussian(texts, i+1, texts.length);
      if (dist.stdev > 0 && texts[i].length >= dist.mean + 2*dist.stdev) tail = i+1;
    }

    toRead = toRead.slice(head.index < tail ? head.index : 0, tail || texts.length);

    //mark the elements for debugging
    $(toRead).addClass("read-aloud");
    return flatten(toRead.map(getText)).filter(isNotEmpty);
  }

  function isIgnore(elem) {
    return $(elem).is(ignoredTags) ||
      isHidden(elem) ||
      $(elem).css("position") == "fixed" ||
      $(elem).css("float") == "right";
  }

  function isHidden(elem) {
    //check width/height/clip?
    return $(elem).is(":hidden") || $(elem).offset().left < 0;
  }

  function isRead(elem) {
    return $(elem).is("details, figure, p, blockquote, pre, code, li, " + headingTags) ||
      childNodes(elem).some(isNonEmptyTextNode);
  }

  function childNodes(elem) {
    var result = [];
    var child = elem.firstChild;
    while (child) {
      result.push(child);
      child = child.nextSibling;
    }
    return result;
  }

  function isNonEmptyTextNode(elem) {
    return elem.nodeType == 3 && elem.nodeValue.trim().length > 1;
  }

  function getGaussian(texts, start, end) {
    var sum = 0;
    for (var i=start; i<end; i++) sum += texts[i].length;
    var mean = sum / (end-start);
    var variance = 0;
    for (var i=start; i<end; i++) variance += (texts[i].length-mean)*(texts[i].length-mean);
    return {mean: mean, stdev: Math.sqrt(variance)};
  }

  function getText(elem) {
    var texts;
    if ($(elem).is("li")) {
      texts = [($(elem).index() +1) + ". " + elem.innerText.trim()];
    }
    else if ($(elem).is(headingTags)) {
      var tmp = $(elem).children(":first").is("a") ? null : $(elem).find("a:visible").hide();
      texts = [elem.innerText.trim()];
      if (tmp) tmp.show();
    }
    else {
      var tmp = $(elem).find("sup").hide();
      texts = addMissingPunctuation(elem.innerText || elem.textContent).trim().split(readAloud.paraSplitter);
      tmp.show();
    }
    return texts;
  }

  function addMissingPunctuation(text) {
    return text.replace(/(\w)(\s*?\r?\n)/g, "$1.$2");
  }

  function flatten(array) {
    return [].concat.apply([], array);
  }

  function getHeadingLevel(elem) {
    var matches = elem && /^H(\d)$/i.exec(elem.tagName);
    return matches && Number(matches[1]);
  }
}


//helpers --------------------------

function isNotEmpty(text) {
  return text;
}

function fixParagraphs(texts) {
  var out = [];
  var para = "";
  for (var i=0; i<texts.length; i++) {
    if (!texts[i]) {
      if (para) {
        out.push(para);
        para = "";
      }
      continue;
    }
    if (para) {
      if (/-$/.test(para)) para = para.substr(0, para.length-1);
      else para += " ";
    }
    para += texts[i].replace(/-\r?\n/g, "");
    if (texts[i].match(/[.!?:)"'\u2019\u201d]$/)) {
      out.push(para);
      para = "";
    }
  }
  if (para) out.push(para);
  return out;
}

function tryGetTexts(getTexts, millis) {
  return waitMillis(500)
    .then(getTexts)
    .then(function(texts) {
      if (texts && !texts.length && millis-500 > 0) return tryGetTexts(getTexts, millis-500);
      else return texts;
    })

  function waitMillis(millis) {
    return new Promise(function(fulfill) {
      setTimeout(fulfill, millis);
    });
  }
}
