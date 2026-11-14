import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermission } from '../tenant/require-permission.decorator';
import { CreateItemDto, ListItemsDto, UpdateItemDto } from './item.dto';
import { ItemView, ItemsService } from './items.service';

@Controller('items')
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get()
  @RequirePermission('items:read')
  async list(@Query() query: ListItemsDto): Promise<{ items: ItemView[] }> {
    return { items: await this.items.list(query) };
  }

  @Get(':id')
  @RequirePermission('items:read')
  find(@Param('id') id: string): Promise<ItemView> {
    return this.items.find(id);
  }

  @Post()
  @RequirePermission('items:manage')
  create(@Body() input: CreateItemDto): Promise<ItemView> {
    return this.items.create(input);
  }

  @Patch(':id')
  @RequirePermission('items:manage')
  update(@Param('id') id: string, @Body() input: UpdateItemDto): Promise<ItemView> {
    return this.items.update(id, input);
  }
}
