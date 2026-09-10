export default function generate({node, params, engine}) {
    const count = Number(params.count || 0)
    for (let index = 0; index < count; index += 1) {
        const child = new engine.Mesh(
            new engine.BoxGeometry(0.25, 0.25, 0.25),
            new engine.MeshStandardMaterial({color: 0x44ccaa}),
        )
        child.name = `Generated ${index + 1}`
        child.position.z = -index * 0.5
        node.add(child)
    }
}
