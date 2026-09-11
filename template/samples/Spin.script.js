import {Object3DComponent} from 'threepipe'

export class Spin extends Object3DComponent {
  static ComponentType = 'Spin'
  speed = 1
  static StateProperties = ['speed']

  update({deltaTime}) {
    this.object.rotation.y += this.speed * deltaTime / 1000
    return true
  }
}
