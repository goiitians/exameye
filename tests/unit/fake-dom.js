// Just enough DOM for popup.js/options.js: elements by id with textContent/className/value,
// a form with named elements and a submit handler.
export function installFakeDom(ids, formFields = []) {
  const el = () => {
    const handlers = {};
    return { textContent: '', className: '', value: '', hidden: false, addEventListener: (type, fn) => { handlers[type] = fn; }, click: () => handlers.click?.({ preventDefault() {} }) };
  };
  const byId = Object.fromEntries(ids.map((id) => [id, el()]));
  if (formFields.length) {
    const handlers = {};
    byId.form = {
      elements: Object.fromEntries(formFields.map((k) => [k, el()])),
      addEventListener: (type, fn) => { handlers[type] = fn; },
      submit: () => handlers.submit({ preventDefault() {} }),
    };
  }
  globalThis.document = { getElementById: (id) => byId[id] };
  return byId;
}
