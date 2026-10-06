/** Injected inside the existing trusted runtime closure. Never enabled for installed apps. */
export const TRIAL_INSPECTION_BRIDGE = `
let trialMode = false;
let lastTrialSequence = 0;
const inspectTrialStep = async (step) => {
  if (!step || typeof step !== 'object') return false;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  if (step.action === 'storage') {
    const value = await request('storage.get', { key: step.key });
    return JSON.stringify(value) === JSON.stringify(step.expected);
  }
  if (typeof step.selector !== 'string' || !/^(?:#[\\w-]+|\\.[\\w-]+|\\[data-[\\w-]+="[\\w-]+"\\])$/.test(step.selector)) return false;
  const element = document.querySelector(step.selector);
  if (!element || !element.getClientRects().length) return false;
  if (step.action === 'fill') {
    if (!['INPUT', 'TEXTAREA'].includes(element.tagName) || element.disabled || element.readOnly || element.type === 'password' || element.type === 'file') return false;
    const setter = Object.getOwnPropertyDescriptor(element.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value').set;
    setter.call(element, String(step.value));
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (step.action === 'click') {
    if (!['BUTTON', 'INPUT'].includes(element.tagName) || element.disabled || element.type === 'file') return false;
    element.click();
  } else if (step.action === 'text') return element.textContent.includes(step.expected);
  else if (step.action === 'value') return String(element.value) === step.expected;
  else return false;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return true;
};
`
