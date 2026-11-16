import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermission } from '../tenant/require-permission.decorator';
import { CreateProjectDto, ListProjectsDto, UpdateProjectDto } from './project.dto';
import {
  ProjectDetail,
  ProjectsService,
  ProjectView,
  TimeEntryView,
} from './projects.service';
import {
  CreateTimeEntryDto,
  ListTimeEntriesDto,
  RollupTimeEntriesDto,
  UpdateTimeEntryDto,
} from './time-entry.dto';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequirePermission('projects:read')
  async list(@Query() query: ListProjectsDto): Promise<{ projects: ProjectView[] }> {
    return { projects: await this.projects.list(query) };
  }

  @Post()
  @RequirePermission('projects:manage')
  create(@Body() input: CreateProjectDto): Promise<ProjectView> {
    return this.projects.create(input);
  }

  @Get(':id')
  @RequirePermission('projects:read')
  find(@Param('id') id: string): Promise<ProjectDetail> {
    return this.projects.find(id);
  }

  @Patch(':id')
  @RequirePermission('projects:manage')
  update(@Param('id') id: string, @Body() input: UpdateProjectDto): Promise<ProjectView> {
    return this.projects.update(id, input);
  }

  @Get(':id/profitability')
  @RequirePermission('projects:read')
  profitability(@Param('id') id: string): Promise<ProjectDetail> {
    return this.projects.find(id);
  }
}

@Controller('time-entries')
export class TimeEntriesController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequirePermission('time:read')
  async list(
    @Query() query: ListTimeEntriesDto,
  ): Promise<{ timeEntries: TimeEntryView[] }> {
    return { timeEntries: await this.projects.listTimeEntries(query) };
  }

  @Post()
  @RequirePermission('time:manage')
  create(@Body() input: CreateTimeEntryDto): Promise<TimeEntryView> {
    return this.projects.createTimeEntry(input);
  }

  @Post('rollup')
  @RequirePermission('time:manage')
  rollup(@Body() input: RollupTimeEntriesDto) {
    return this.projects.rollup(input);
  }

  @Patch(':id')
  @RequirePermission('time:manage')
  update(
    @Param('id') id: string,
    @Body() input: UpdateTimeEntryDto,
  ): Promise<TimeEntryView> {
    return this.projects.updateTimeEntry(id, input);
  }

  @Delete(':id')
  @RequirePermission('time:manage')
  async remove(@Param('id') id: string): Promise<{ deleted: true }> {
    await this.projects.deleteTimeEntry(id);
    return { deleted: true };
  }
}
