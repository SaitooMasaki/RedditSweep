/**
 * Unit test setup
 * jest-webextension-mock (loaded via setupFiles) provides:
 *   chrome.storage.local, chrome.alarms, chrome.runtime, chrome.tabs ...
 *
 * This file handles anything jest-webextension-mock doesn't cover.
 */

// Make chrome.storage.local.get/set behave like a real async store
// jest-webextension-mock uses callbacks; wrap them to return Promises.
const _store = {};

beforeEach(() => {
  // Clear in-memory store
  Object.keys(_store).forEach(k => delete _store[k]);

  // Patch chrome.storage.local to use _store
  chrome.storage.local.get.mockImplementation((keys, cb) => {
    let result;
    if (keys === null) {
      result = { ..._store };
    } else if (typeof keys === 'string') {
      result = { [keys]: _store[keys] };
    } else if (Array.isArray(keys)) {
      result = Object.fromEntries(keys.map(k => [k, _store[k]]));
    } else {
      result = Object.fromEntries(Object.keys(keys).map(k => [k, _store[k] ?? keys[k]]));
    }
    if (cb) cb(result);
    return Promise.resolve(result);
  });

  chrome.storage.local.set.mockImplementation((obj, cb) => {
    Object.assign(_store, obj);
    if (cb) cb();
    return Promise.resolve();
  });

  chrome.storage.local.remove.mockImplementation((keys, cb) => {
    (Array.isArray(keys) ? keys : [keys]).forEach(k => delete _store[k]);
    if (cb) cb();
    return Promise.resolve();
  });

  chrome.storage.local.clear.mockImplementation((cb) => {
    Object.keys(_store).forEach(k => delete _store[k]);
    if (cb) cb();
    return Promise.resolve();
  });

  // Mock fetch (tests override this per-case)
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.clearAllMocks();
});
