import { bufferToHex, keccak256, toBuffer } from 'ethereumjs-util'
import { ethers } from 'ethers'

export default class MerkleTree {
  private readonly elements: Buffer[]
  private readonly bufferElementPositionIndex: { [hexElement: string]: number }
  private readonly layers: Buffer[][]

  constructor(elements: Buffer[]) {
    this.elements = [...elements]
    // Sort elements
    //this.elements.sort(Buffer.compare) !!!!! MURKY::: WE ASSUME ELEMENTS ARE PRE-SORTED BY USER
    // Deduplicate elements
    //this.elements = MerkleTree.bufDedup(this.elements) !!!!! MURKY::: GENERIC TREE

    this.bufferElementPositionIndex = this.elements.reduce<{ [hexElement: string]: number }>((memo, element, index) => {
      memo[bufferToHex(element)] = index
      return memo
    }, {})

    // Create layers
    this.layers = this.getLayers(this.elements)
  }

  getLayers(elements: Buffer[]): Buffer[][] {
    if (elements.length === 0) {
      throw new Error('empty tree')
    }

    const layers = [ elements]

    // Get next layer until we reach the root
    while (layers.at(-1).length > 1) {
      layers.push(this.getNextLayer(layers.at(-1)))
    }

    return layers
  }

  getNextLayer(elements: Buffer[]): Buffer[] {
    return elements.reduce<Buffer[]>((layer, element, index, array) => {
      if (index % 2 === 0) {
        // Hash the current element with its pair element
        layer.push(MerkleTree.combinedHash(element, array[index + 1]))
      }

      return layer
    }, [])
  }

  static combinedHash(first: Buffer, second: Buffer): Buffer {
    if (!first) {
      first = toBuffer("0x0000000000000000000000000000000000000000000000000000000000000000") //!!!!! MURKY::: ALWAYS NEED TO HASH EACH LAYER
    }
    if (!second) {
      second = toBuffer("0x0000000000000000000000000000000000000000000000000000000000000000") //!!!!! MURKY::: ALWAYS NEED TO HASH EACH LAYER
    }

    return keccak256(MerkleTree.sortAndConcat(first, second))
  }

  getRoot(): Buffer {
    return this.layers.at(-1)[0]
  }

  getHexRoot(): string {
    return bufferToHex(this.getRoot())
  }

  getProof(element: Buffer) {
    let index = this.bufferElementPositionIndex[bufferToHex(element)]

    if (typeof index !== 'number') {
      throw new TypeError('Element does not exist in Merkle tree')
    }

    return this.layers.reduce((proof, layer) => {
      const pairElement = MerkleTree.getPairElement(index, layer)

      if (pairElement) {
        proof.push(pairElement)
      }

      index = Math.floor(index / 2)

      return proof
    }, [])
  }

  getHexProof(element: Buffer): string[] {
    const proof = this.getProof(element)

    return MerkleTree.bufArrToHexArr(proof)
  }

  private static getPairElement(index: number, layer: Buffer[]): Buffer | null {
    const pairIndex = index % 2 === 0 ? index + 1 : index - 1

    if (pairIndex < layer.length) {
      return layer[pairIndex]
    } 
      return null
    
  }

  private static bufDedup(elements: Buffer[]): Buffer[] {
    return elements.filter((element, index) => {
      return index === 0 || !elements[index - 1].equals(element)
    })
  }

  private static bufArrToHexArr(array: Buffer[]): string[] {
    if (array.some((element) => !Buffer.isBuffer(element))) {
      throw new Error('Array is not an array of buffers')
    }

    return array.map((element) => `0x${  element.toString('hex')}`)
  }

  public static sortAndConcat(...arguments_: Buffer[]): Buffer {
    return Buffer.concat([...arguments_].sort(Buffer.compare));
  }
}