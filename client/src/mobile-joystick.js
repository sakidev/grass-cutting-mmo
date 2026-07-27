export { MobileJoystick };

class MobileJoystick
{
    constructor()
    {
        const self = this;

        document.addEventListener("touchstart", (e)=>{
            for(let i = 0; i < e.changedTouches.length; i++)
                self.onTouchStart(e.changedTouches[i]);
        }, { passive: false });

        document.addEventListener("touchmove", (e)=>{
            e.preventDefault();      // stops page scroll / rubber-band while swiping
            self.onTouchMove(e);
        }, { passive: false });

        document.addEventListener("touchend", (e)=>{
            self.onTouchEnd(e);
        }, { passive: false });

        document.addEventListener("touchcancel", (e)=>{
            self.onTouchEnd(e);      // treat cancel like end so state doesn't get stuck
        }, { passive: false });

        // The one and only joystick
        this.joystick = {
            identifier: null,
            startX: 0,
            startY: 0,
            currentX: 0,
            currentY: 0,
            deltaX: 0,
            deltaY: 0,
            element: null,
        };
        this.direction = new pc.Vec2(0, 0); // Movement direction vector

        this.wasTouchActive = false;

        this.inventoryLastTouchX = null;

        //document.getElementById("mobile-buttons").style.display = "none";
    }

    isBlockedByUI()
    {
        return false;
        return document.getElementById("play-button-container").className !== "hidden"
            || ui.isMouseOverUI
            || document.getElementById("worldcup-presentation-container").className !== "hidden"
            || document.getElementById("worldcup-country-container").style.display !== "none";
    }

    createJoystickElement(x, y)
    {
        this.joystick.element = document.createElement("div");
        this.joystick.element.innerHTML = `
            <div class="joystick-base"></div>
            <div class="joystick-stick"></div>
        `;
        this.joystick.element.id = "joystick";
        this.joystick.element.style.left = x + "px";
        this.joystick.element.style.top = y + "px";
        document.body.appendChild(this.joystick.element);
    }

    findTouchByIdentifier(event, identifier)
    {
        for(let i = 0; i < event.touches.length; i++)
        {
            const touch = event.touches[i];
            if(touch.identifier === identifier)
                return touch;
        }

        for(let i = 0; i < event.changedTouches.length; i++)
        {
            const touch = event.changedTouches[i];
            if(touch.identifier === identifier)
                return touch;
        }

        return null;
    }

    updateCardEulers(clientX, clientY)
    {
        camera.controller.cameraEulers.x = 0;
        camera.controller.cameraEulers.y = 0;

        const offsetX = clientX - window.innerWidth / 2;
        const offsetY = clientY - window.innerHeight / 2;

        const maxX = window.innerWidth / 2;
        const maxY = window.innerHeight / 2;

        const nx = Math.max(-1, Math.min(1, offsetX / maxX));
        const ny = Math.max(-1, Math.min(1, offsetY / maxY));

        const EXPONENT = 0.75;
        // ease in the normalized value (keep sign)
        const curvedX = Math.sign(nx) * Math.pow(Math.abs(nx), EXPONENT) * 460;
        const curvedY = Math.sign(ny) * Math.pow(Math.abs(ny), EXPONENT) * 736;

        camera.controller.cardEulers.x = curvedY * CameraController.MOUSE_SENSITIVITY[1];
        camera.controller.cardEulers.y = -curvedX * CameraController.MOUSE_SENSITIVITY[0];
    }

    onTouchStart(touch)
    {
        if(this.isBlockedByUI())
            return;

        /*if(INVENTORY_SCENE && INVENTORY_SCENE.enabled)
        {
            this.inventoryLastTouchX = touch.clientX;
            camera.controller.isLeftMouseDown = true;
            this.updateCardEulers(touch.clientX, touch.clientY);
            return;
        }*/

        if(this.wasTouchActive)
            return;

        this.joystick.startX = touch.clientX;
        this.joystick.startY = touch.clientY;
        this.joystick.currentX = touch.clientX;
        this.joystick.currentY = touch.clientY;
        this.joystick.deltaX = 0;
        this.joystick.deltaY = 0;
        this.joystick.identifier = touch.identifier;

        if(this.joystick.element === null)
            this.createJoystickElement(touch.clientX, touch.clientY);

        this.joystick.element.style.left = touch.clientX - 60 + "px";
        this.joystick.element.style.top = touch.clientY - 60 + "px";
        this.joystick.element.querySelector(".joystick-stick").style.transform = `translate(0, 0)`;
        this.joystick.element.style.display = "block";

        this.direction.set(0, 0);

        this.wasTouchActive = true;
    }

    onTouchMove(event)
    {
        /*if(INVENTORY_SCENE && INVENTORY_SCENE.enabled)
        {
            const touchX = event.touches[0].clientX;
            const touchY = event.touches[0].clientY;

            if(INVENTORY_ITEMS.length > 0)
            {
                if(this.inventoryLastTouchX == null)
                    this.inventoryLastTouchX = touchX;

                const dx = touchX - this.inventoryLastTouchX;
                this.inventoryLastTouchX = touchX;

                camera.controller.inventoryScroll += dx * 0.01;
            }

            this.updateCardEulers(touchX, touchY);
            return;
        }*/

        if(this.joystick.identifier === null)
            return;

        const touch = this.findTouchByIdentifier(event, this.joystick.identifier);
        if(!touch || !this.joystick.element)
            return;

        this.joystick.currentX = touch.clientX;
        this.joystick.currentY = touch.clientY;
        this.joystick.deltaX = touch.clientX - this.joystick.startX;
        this.joystick.deltaY = touch.clientY - this.joystick.startY;

        const stick = this.joystick.element.querySelector(".joystick-stick");

        // Lock the movement to a maximum radius of 35 pixels
        const distance = Math.sqrt(this.joystick.deltaX * this.joystick.deltaX + this.joystick.deltaY * this.joystick.deltaY);
        if(distance > 35)
        {
            const angle = Math.atan2(this.joystick.deltaY, this.joystick.deltaX);
            this.joystick.deltaX = Math.cos(angle) * 35;
            this.joystick.deltaY = Math.sin(angle) * 35;
        }

        stick.style.transform = `translate(${this.joystick.deltaX}px, ${this.joystick.deltaY}px)`;
        this.direction.set(this.joystick.deltaX / 35, this.joystick.deltaY / 35);
    }

    onTouchEnd(event)
    {
        /*if(INVENTORY_SCENE && INVENTORY_SCENE.enabled)
        {
            this.inventoryLastTouchX = null;
            camera.controller.isLeftMouseDown = false;
            camera.controller.cardEulers.set(0, 0, 0);
            return;
        }*/

        for(let i = 0; i < event.changedTouches.length; i++)
        {
            if(event.changedTouches[i].identifier !== this.joystick.identifier)
                continue;

            this.joystick.identifier = null;
            this.direction.set(0, 0);

            if(this.joystick.element)
                this.joystick.element.style.display = "none";

            this.wasTouchActive = false;
        }
    }
}