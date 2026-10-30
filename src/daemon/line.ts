export class Lines {
  private readonly holds = new Map<string, number>()
  private readonly waiters = new Map<string, Set<() => void>>()
  private readonly tails = new Map<string, Promise<unknown>>()

  hold(endpoint: string): () => void {
    this.holds.set(endpoint, (this.holds.get(endpoint) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const left = (this.holds.get(endpoint) ?? 1) - 1
      if (left > 0) {
        this.holds.set(endpoint, left)
        return
      }
      this.holds.delete(endpoint)
      for (const wake of [...(this.waiters.get(endpoint) ?? [])]) wake()
    }
  }

  busy(endpoint: string): boolean {
    return this.holds.has(endpoint)
  }

  whenFree(endpoint: string, timeoutMs = 60000): Promise<void> {
    if (!this.busy(endpoint)) return Promise.resolve()
    return new Promise(resolve => {
      const waiters = this.waiters.get(endpoint) ?? new Set<() => void>()
      this.waiters.set(endpoint, waiters)
      const done = () => {
        clearTimeout(timer)
        waiters.delete(done)
        if (waiters.size === 0) this.waiters.delete(endpoint)
        resolve()
      }
      const timer = setTimeout(done, timeoutMs)
      waiters.add(done)
    })
  }

  serialize<T>(endpoint: string, task: () => Promise<T>): Promise<T> {
    const next = (this.tails.get(endpoint) ?? Promise.resolve()).then(task)
    const settled = next.catch(() => {})
    this.tails.set(endpoint, settled)
    void settled.then(() => {
      if (this.tails.get(endpoint) === settled) this.tails.delete(endpoint)
    })
    return next
  }
}
