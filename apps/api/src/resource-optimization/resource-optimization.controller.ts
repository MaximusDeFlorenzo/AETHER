import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ResourceOptimizationService } from './resource-optimization.service';
import { CreateResourceOptimizationPlanDto } from './dto/create-resource-optimization-plan.dto';
import { CreateShelterDto } from './dto/create-shelter.dto';
import { QueryResourceOptimizationPlansDto } from './dto/query-resource-optimization-plans.dto';
import { QuerySheltersDto } from './dto/query-shelters.dto';
import { UpdateShelterDto } from './dto/update-shelter.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RoleName } from '../common/enums/roles.enum';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';

// GET routes are public read-only risk-intelligence surface (docs/API_SPEC.md
// §"Auth guard posture") — only the mutating routes require auth.
@ApiTags('resource-optimization')
@Controller()
export class ResourceOptimizationController {
  constructor(
    private readonly resourceOptimizationService: ResourceOptimizationService,
  ) {}

  @Get('resource-optimization-plans')
  findAllPlans(@Query() query: QueryResourceOptimizationPlansDto) {
    return this.resourceOptimizationService.findAllPlans({
      district: query.district,
      hazardType: query.hazardType,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('resource-optimization-plans/:id')
  findOnePlan(@Param('id', ParseUUIDPipe) id: string) {
    return this.resourceOptimizationService.findOnePlan(id);
  }

  @Post('resource-optimization-plans')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleName.ADMIN, RoleName.AGENCY_OPERATOR)
  createPlan(@Body() dto: CreateResourceOptimizationPlanDto) {
    return this.resourceOptimizationService.createPlan(dto);
  }

  @Get('shelters')
  findAllShelters(@Query() query: QuerySheltersDto) {
    return this.resourceOptimizationService.findAllShelters({
      district: query.district,
      kind: query.kind,
      includeInactive: query.includeInactive,
    });
  }

  @Post('shelters')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleName.ADMIN, RoleName.AGENCY_OPERATOR)
  createShelter(@Body() dto: CreateShelterDto) {
    return this.resourceOptimizationService.createShelter(dto);
  }

  @Patch('shelters/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleName.ADMIN, RoleName.AGENCY_OPERATOR)
  updateShelter(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShelterDto,
  ) {
    return this.resourceOptimizationService.updateShelter(id, dto);
  }

  @Delete('shelters/:id')
  @HttpCode(204)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleName.ADMIN, RoleName.AGENCY_OPERATOR)
  deleteShelter(@Param('id', ParseUUIDPipe) id: string) {
    return this.resourceOptimizationService.deleteShelter(id);
  }
}
