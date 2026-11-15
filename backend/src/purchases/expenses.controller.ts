import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermission } from '../tenant/require-permission.decorator';
import {
  CreateExpenseDto,
  ListExpensesDto,
  UpdateExpenseDto,
} from './expense.dto';
import { ExpenseView, ExpensesService } from './expenses.service';

@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  @RequirePermission('expenses:read')
  async list(@Query() query: ListExpensesDto): Promise<{ expenses: ExpenseView[] }> {
    return { expenses: await this.expenses.list(query) };
  }

  @Get(':id')
  @RequirePermission('expenses:read')
  find(@Param('id') id: string): Promise<ExpenseView> {
    return this.expenses.find(id);
  }

  @Post()
  @RequirePermission('expenses:manage')
  create(@Body() input: CreateExpenseDto): Promise<ExpenseView> {
    return this.expenses.create(input);
  }

  @Patch(':id')
  @RequirePermission('expenses:manage')
  update(
    @Param('id') id: string,
    @Body() input: UpdateExpenseDto,
  ): Promise<ExpenseView> {
    return this.expenses.update(id, input);
  }
}
