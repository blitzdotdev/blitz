/**
 * Example usage of HtmlUiComponent
 *
 * This file demonstrates how to use the HtmlUiComponent with threepipe
 */

import { HtmlUiComponent } from './HtmlUiComponent'
import { IViewer, EntityComponentPlugin, IObject3D } from 'threepipe'

/**
 * Initialize the HtmlUiComponent for a viewer
 */
export function initHtmlUiComponent(viewer: IViewer) {
    // The EntityComponentPlugin should already be added to the viewer
    // If not, add it:
    // viewer.addPluginSync(EntityComponentPlugin)
}

/**
 * Add a simple label to an object that follows it in 3D space
 */
export function addObjectLabel(object: IObject3D, labelText: string) {
    return EntityComponentPlugin.AddComponent(object, HtmlUiComponent, {
        htmlData: `
            <div style="
                background: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 8px 12px;
                border-radius: 5px;
                font-family: Arial, sans-serif;
                font-size: 14px;
                white-space: nowrap;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            ">
                ${labelText}
            </div>
        `,
        width: 150,
        height: 40,
        positionMode: 'world',
        offsetY: -50, // Position above the object
        scrollable: false,
        interactable: false,
        visible: true,
        zIndex: 1000
    })
}

/**
 * Add an info panel to an object
 */
export function addInfoPanel(object: IObject3D, title: string, content: string) {
    return EntityComponentPlugin.AddComponent(object, HtmlUiComponent, {
        htmlData: `
            <div style="
                background: white;
                padding: 15px;
                border-radius: 8px;
                font-family: Arial, sans-serif;
                box-shadow: 0 4px 16px rgba(0,0,0,0.2);
                border: 1px solid #ccc;
            ">
                <h3 style="margin: 0 0 10px 0; font-size: 16px; color: #333;">${title}</h3>
                <p style="margin: 0; font-size: 13px; color: #666; line-height: 1.5;">${content}</p>
            </div>
        `,
        width: 250,
        height: 150,
        positionMode: 'world',
        offsetX: 100,
        offsetY: -100,
        scrollable: true,
        interactable: true,
        visible: false, // Start hidden
        zIndex: 1000
    })
}

/**
 * Add a fixed HUD element
 */
export function addHudElement(object: IObject3D, htmlContent: string, x: number, y: number) {
    return EntityComponentPlugin.AddComponent(object, HtmlUiComponent, {
        htmlData: htmlContent,
        width: 200,
        height: 100,
        positionMode: 'screen',
        offsetX: x,
        offsetY: y,
        scrollable: false,
        interactable: true,
        visible: true,
        zIndex: 1001
    })
}

/**
 * Add an interactive button panel
 */
export function addButtonPanel(object: IObject3D, onButtonClick: () => void) {
    const component = EntityComponentPlugin.AddComponent(object, HtmlUiComponent, {
        htmlData: `
            <div style="
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                padding: 15px;
                border-radius: 10px;
                box-shadow: 0 4px 16px rgba(0,0,0,0.3);
            ">
                <button id="action-button" style="
                    background: white;
                    border: none;
                    padding: 10px 20px;
                    border-radius: 5px;
                    cursor: pointer;
                    font-weight: bold;
                    color: #667eea;
                    font-size: 14px;
                    transition: transform 0.2s;
                ">
                    Click Me
                </button>
            </div>
        `,
        width: 140,
        height: 70,
        positionMode: 'world',
        offsetY: 50,
        scrollable: false,
        interactable: true,
        visible: true,
        zIndex: 1000
    })

    // Add event listener after component is initialized
    setTimeout(() => {
        const button = component.element?.querySelector('#action-button')
        if (button) {
            button.addEventListener('click', onButtonClick)
        }
    }, 0)

    return component
}

/**
 * Example: Complete usage scenario
 */
export function exampleUsage(viewer: IViewer, targetObject: IObject3D) {
    // Initialize
    initHtmlUiComponent(viewer)

    // Add a label that follows the object
    const label = addObjectLabel(targetObject, 'Important Object')

    // Add an info panel that can be toggled
    const infoPanel = addInfoPanel(
        targetObject,
        'Object Details',
        'This object has special properties. Click to learn more about its configuration.'
    )

    // Add an interactive button
    const buttonPanel = addButtonPanel(targetObject, () => {
        // Toggle info panel visibility
        infoPanel.visible = !infoPanel.visible
        console.log('Button clicked! Info panel toggled.')
    })

    // Add a fixed HUD
    const hud = addHudElement(
        targetObject,
        `<div style="background: rgba(0,0,0,0.8); color: white; padding: 10px; border-radius: 5px;">
            <strong>Status:</strong> Active
        </div>`,
        10,
        10
    )

    // Return components for further manipulation
    return { label, infoPanel, buttonPanel, hud }
}

/**
 * Dynamic content update example
 */
export function updateLabelContent(component: HtmlUiComponent, newText: string) {
    component.setHtml(`
        <div style="
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 8px 12px;
            border-radius: 5px;
            font-family: Arial, sans-serif;
            font-size: 14px;
            white-space: nowrap;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        ">
            ${newText}
        </div>
    `)
}

