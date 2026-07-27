class UI
{
    constructor()
    {
        const uiElement = document.createElement("div");
        uiElement.id = "ui";
        uiElement.innerHTML = "";
        document.body.appendChild(uiElement);

        //this.injectHTML(UI_MOBILE_CONTROLS);

        //if(isMobile)
        if(true)
        {
            this.mobileJoystick = new MobileJoystick();
        }
    }

    injectHTML(htmlAsText)
    {
        const uiElement = document.getElementById("ui");
        if(!uiElement)
            return;

        uiElement.appendChild(htmlAsText);
    }

    update(dt)
    {

    }

    postUpdate(dt)
    {
        
    }
}