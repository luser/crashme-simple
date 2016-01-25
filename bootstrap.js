/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
/*global Components, Services, ctypes, XPCOMUtils, CustomizableUI */

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/JNI.jsm");

/**
 * Apply a callback to each open and new browser windows.
 *
 * @usage watchWindows(callback): Apply a callback to each browser window.
 * @param [function] callback: 1-parameter function that gets a browser window.
 * @param [string] option: If set to "enumerate-only", don't add a listener
 *   for future window-opens.
 */
function watchWindows(callback, option) {
  function watcher(window) {
    // Now that the window has loaded, only handle browser windows
    let {documentElement} = window.document;
    if (documentElement.getAttribute("windowtype") == "navigator:browser")
      callback(window);
  }

  // Wait for the window to finish loading before running the callback
  function runOnLoad(window) {
    // Listen for one load event before checking the window type
    window.addEventListener("load", function runOnce() {
      window.removeEventListener("load", runOnce, false);
      watcher(window);
    }, false);
  }

  // Add functionality to existing windows
  let windows = Services.wm.getEnumerator(null);
  while (windows.hasMoreElements()) {
    // Only run the watcher immediately if the window is completely loaded
    let window = windows.getNext();
    if (window.document.readyState == "complete")
      watcher(window);
    // Wait for the window to load before continuing
    else
      runOnLoad(window);
  }

  // Watch for new browser windows opening then wait for it to load
  function windowWatcher(subject, topic) {
    if (topic == "domwindowopened")
      runOnLoad(subject);
  }
  if (option != "just-enumerate") {
    Services.ww.registerNotification(windowWatcher);
    // Make sure to stop watching for windows if we're unloading
    unload(function() Services.ww.unregisterNotification(windowWatcher));
  }
}

/**
 * Save callbacks to run when unloading. Optionally scope the callback to a
 * container, e.g., window. Provide a way to run all the callbacks.
 *
 * @usage unload(): Run all callbacks and release them.
 *
 * @usage unload(callback): Add a callback to run on unload.
 * @param [function] callback: 0-parameter function to call on unload.
 * @return [function]: A 0-parameter function that undoes adding the callback.
 *
 * @usage unload(callback, container) Add a scoped callback to run on unload.
 * @param [function] callback: 0-parameter function to call on unload.
 * @param [node] container: Remove the callback when this container unloads.
 * @return [function]: A 0-parameter function that undoes adding the callback.
 */
function unload(callback, container) {
  // Initialize the array of unloaders on the first usage
  let unloaders = unload.unloaders;
  if (unloaders == null)
    unloaders = unload.unloaders = [];

  // Calling with no arguments runs all the unloader callbacks
  if (callback == null) {
    unloaders.slice().forEach(function(unloader) unloader());
    unloaders.length = 0;
    return;
  }

  function removeUnloader() {
    let index = unloaders.indexOf(unloader);
    if (index != -1)
      unloaders.splice(index, 1);
  }

  // The callback is bound to the lifetime of the container if we have one
  if (container != null) {
    // Remove the unloader when the container unloads
    container.addEventListener("unload", removeUnloader, false);

    // Wrap the callback to additionally remove the unload listener
    let origCallback = callback;
    callback = function() {
      container.removeEventListener("unload", removeUnloader, false);
      origCallback();
    };
  }

  // Wrap the callback in a function that ignores failures
  function unloader() {
    try {
      callback();
    }
    catch(ex) {}
  }
  unloaders.push(unloader);
}

function crash() {
  Components.utils.import("resource://gre/modules/ctypes.jsm");
  // ctypes checks for NULL pointer derefs, so just go near-NULL.
  var zero = new ctypes.intptr_t(8);
  var badptr = ctypes.cast(zero, ctypes.PointerType(ctypes.int32_t));
  var crash = badptr.contents;
}

function crashJava() {
  let jenv = JNI.GetForThread();
  JNI.LoadClass(jenv, "org.mozilla.gecko.GeckoAppShell", {
    static_methods: [
      { name: "doesNotExist", sig: "()I" }
    ],
  });
}

function crash_content() {
  let wm = Cc["@mozilla.org/appshell/window-mediator;1"].
        getService(Ci.nsIWindowMediator);
  let win = wm.getMostRecentWindow("navigator:browser");
  let browser = win.gBrowser.selectedBrowser;
  if (browser.isRemoteBrowser) {
    browser.messageManager.loadFrameScript("resource://crashmesimple/contentscript.js", true);
  } else {
    // Could try harder and force-load an e10s window or something.
  }
}

let menuIDs = new WeakMap();
let metroSettingsPanelEntryId;

function addUI(window) {
  let document = window.document;
  if (Services.appinfo.ID == "{aa3c5121-dab2-40e2-81ca-7ea25febc110}") {
    // Android Fennec
    menuIDs.set(window, [window.NativeWindow.menu.add("Crash me (native)!", null, function() {
                  crash();
                }),
                window.NativeWindow.menu.add("Crash me (Java)!", null, function() {
                  crashJava();
                })]);
  }
}

function removeUI(window) {
  if (Services.appinfo.ID == "{aa3c5121-dab2-40e2-81ca-7ea25febc110}") {
    if (menuIDs.has(window)) {
      menuIDs.get(window).forEach(function(menuId) {
        window.NativeWindow.menu.remove(menuId);
      });
      menuIDs.delete(window);
    }
  }
}

var ss = null;
var cssuri = null;

function install(data, reason) {}
function uninstall(data, reason) {}

function startup(data, reason) {
  let resource = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
  resource.setSubstitution("crashmesimple", data.resourceURI);
  watchWindows(addUI);
  if (Services.appinfo.ID == "{ec8030f7-c20a-464f-9b0e-13a3a9e97384}") {
    let io =
          Cc["@mozilla.org/network/io-service;1"].
          getService(Ci.nsIIOService);

    // the 'style' directive isn't supported in chrome.manifest for boostrapped
    // extensions, so this is the manual way of doing the same.
    ss =
      Cc["@mozilla.org/content/style-sheet-service;1"].
      getService(Ci.nsIStyleSheetService);
    cssuri = io.newURI("chrome://crashmesimple/skin/toolbar.css", null, null);
    ss.loadAndRegisterSheet(cssuri, ss.USER_SHEET);

    // Add a toolbar button
    Components.utils.import("resource:///modules/CustomizableUI.jsm");
    CustomizableUI.createWidget({
      id: "toolbarbutton-crashmesimple",
      removable: true,
      label: "Crash me!",
      tooltiptext: "Crash your browser",
      onCommand: function() {
        crash();
      }
    });

    CustomizableUI.createWidget({
      id: "toolbarbutton-crashmesimple-content",
      removable: true,
      label: "Crash content process!",
      tooltiptext: "Crash the content process",
      onCommand: function() {
        crash_content();
      }
    });
  }
}

function shutdown(data, reason) {
  watchWindows(removeUI, "enumerate-only");
  let resource = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
  resource.setSubstitution("crashmesimple", null);

  if (Services.appinfo.ID == "{ec8030f7-c20a-464f-9b0e-13a3a9e97384}") {
    CustomizableUI.destroyWidget("toolbarbutton-crashmesimple");
    CustomizableUI.destroyWidget("toolbarbutton-crashmesimple-content");
  }
  if (ss && cssuri) {
    if (ss.sheetRegistered(cssuri, ss.USER_SHEET)) {
      ss.unregisterSheet(cssuri, ss.USER_SHEET);
    }
  }
}
