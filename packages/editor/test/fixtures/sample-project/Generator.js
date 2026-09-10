export default function generate({node, params, engine}) {
    const count = Number(params.count || 0)
    for (let index = 0; index < count; index += 1) {
        const child = new engine.Group()
        child.name = `Generated ${index + 1}`
        node.add(child)
    }
}
