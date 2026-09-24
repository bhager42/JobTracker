import '@testing-library/jest-dom/vitest'

// jsdom lacks these browser APIs, which the theme provider and Radix primitives use.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia

window.scrollTo = () => {}
Element.prototype.scrollIntoView ??= () => {}
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.releasePointerCapture ??= () => {}
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// jsdom's FormData/File can't be read by Node's fetch `Request` (they come from different
// implementations), so multipart requests would crash in tests though they work in browsers.
// This Request keeps the FormData object aside for the fake API in `src/test/render-app.tsx`.
const NodeRequest = globalThis.Request
class TestRequest extends NodeRequest {
  formDataBody?: FormData

  constructor(input: RequestInfo | URL, init?: RequestInit) {
    const body = init?.body
    if (body instanceof FormData) {
      const headers = new Headers(init?.headers)
      headers.set('content-type', 'multipart/form-data; boundary=test')
      super(input, { ...init, body: undefined, headers })
      this.formDataBody = body
    } else {
      super(input, init)
      if (input instanceof TestRequest) this.formDataBody = input.formDataBody
    }
  }
}
globalThis.Request = TestRequest as typeof Request
