
class MinHeap {
  constructor(scoreFn) {
    this.a = []  // 配列として管理
    this.score = scoreFn  // ノードのスコア（f値）を取得する関数
  }

  push(node) {
    this.a.push(node)
    this._up(this.a.length - 1)
  }

  pop() {
    if (this.a.length === 0) return undefined
    const result = this.a[0]
    const last = this.a.pop()
    if (this.a.length > 0) {
      this.a[0] = last
      this._down(0)
    }
    return result
  }

  get size() {
    return this.a.length
  }

  _up(i) {
    const node = this.a[i]
    const nodeScore = this.score(node)
    while (i > 0) {
      const pi = ((i - 1) >> 1)  // 親インデックス
      const parent = this.a[pi]
      if (this.score(parent) <= nodeScore) break
      this.a[i] = parent
      i = pi
    }
    this.a[i] = node
  }

  _down(i) {
    const node = this.a[i]
    const nodeScore = this.score(node)
    const len = this.a.length
    const half = len >> 1
    while (i < half) {
      let ci = (i << 1) + 1  // 左子インデックス
      let child = this.a[ci]
      const ri = ci + 1
      // 右子が存在し、右子の方がスコアが小さければ右子を選択
      if (ri < len && this.score(this.a[ri]) < this.score(child)) {
        ci = ri
        child = this.a[ri]
      }
      if (nodeScore <= this.score(child)) break
      this.a[i] = child
      i = ci
    }
    this.a[i] = node
  }
}

module.exports = { MinHeap }
