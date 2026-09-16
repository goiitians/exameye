export const setPeriodic = (name, periodInMinutes) => chrome.alarms.create(name, { periodInMinutes });
export const setAt = (name, when) => chrome.alarms.create(name, { when });
export const clear = (name) => chrome.alarms.clear(name);
export const get = (name) => chrome.alarms.get(name);
