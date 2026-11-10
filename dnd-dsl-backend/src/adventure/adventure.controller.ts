import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { DndDslParseError } from '@dnd-cli/main.js';
import { AdventureService } from './adventure.service.js';
import { AdventureError, type WorldRef } from './adventure-store.js';

@Controller('adventure')
export class AdventureController {
    constructor(private readonly adventureService: AdventureService) {}

    @Get('active')
    active() {
        return this.adventureService.active();
    }

    @Get('list')
    list() {
        return this.adventureService.list();
    }

    @Post('open')
    open(@Query('adventure') adventure: string, @Query('world') world: string) {
        return this.run(() => this.adventureService.open(adventure, world));
    }

    @Post('new')
    create(@Body() body: WorldRef) {
        return this.run(() => this.adventureService.create({ adventure: body?.adventure, world: body?.world }));
    }

    @Post('save-as')
    saveAs(@Body() body: WorldRef) {
        return this.run(() => this.adventureService.saveAs({ adventure: body?.adventure, world: body?.world }));
    }

    @Get('states')
    states() {
        return this.run(() => this.adventureService.listStates());
    }

    @Post('states/save')
    saveState(@Body() body: { name: string }) {
        return this.run(() => this.adventureService.saveState(body?.name));
    }

    @Post('states/load')
    loadState(@Body() body: { name: string }) {
        return this.run(() => this.adventureService.loadState(body?.name));
    }

    @Post('reveal')
    reveal() {
        return this.run(() => this.adventureService.reveal());
    }

    /** A caller's mistake or a world that does not parse is a 400 with a readable message; anything else stays a 500. */
    private async run<T>(action: () => T | Promise<T>): Promise<T | { success: true }> {
        try {
            return (await action()) ?? { success: true };
        } catch (e) {
            if (e instanceof AdventureError) throw new BadRequestException(e.message);
            if (e instanceof DndDslParseError) {
                const errors = e.diagnostics.map(d => d.message);
                throw new BadRequestException({ message: `The world has errors: ${errors.join('; ')}`, errors });
            }
            throw e;
        }
    }
}
