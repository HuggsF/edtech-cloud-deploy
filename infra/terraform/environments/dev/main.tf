terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# ------------------------------------------------------------------------------
# Networking Mock / Lookup (In production, replace with data.aws_vpc or aws_vpc)
# ------------------------------------------------------------------------------
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

resource "aws_security_group" "alb" {
  name        = "edtech-alb-sg-${var.environment}"
  description = "Allow inbound HTTP to ALB"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "ecs" {
  name        = "edtech-ecs-sg-${var.environment}"
  description = "Allow inbound from ALB to ECS tasks"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "rds" {
  name        = "edtech-rds-sg-${var.environment}"
  description = "Allow MySQL from ECS tasks"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port       = 3306
    to_port         = 3306
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ------------------------------------------------------------------------------
# Modules
# ------------------------------------------------------------------------------
module "alb" {
  source             = "../../modules/alb"
  environment        = var.environment
  vpc_id             = data.aws_vpc.default.id
  subnet_ids         = data.aws_subnets.default.ids
  security_group_ids = [aws_security_group.alb.id]
}

module "rds" {
  source             = "../../modules/rds"
  environment        = var.environment
  subnet_ids         = data.aws_subnets.default.ids
  security_group_ids = [aws_security_group.rds.id]
  database_name      = var.database_name
  admin_username     = var.db_username
  admin_password     = var.db_password
  multi_az           = false
  instance_class     = "db.t4g.micro"
}

module "ecs" {
  source              = "../../modules/ecs"
  environment         = var.environment
  aws_region          = var.aws_region
  subnet_ids          = data.aws_subnets.default.ids
  security_group_ids  = [aws_security_group.ecs.id]
  target_group_arn    = module.alb.target_group_arn
  docker_image        = var.docker_image
  db_host             = module.rds.db_address
  db_port             = module.rds.db_port
  db_name             = module.rds.db_name
  db_user             = var.db_username
  db_password         = var.db_password
  rabbitmq_url        = var.rabbitmq_url
  api_desired_count   = 2
  worker_min_capacity = 2
}

module "autoscaling" {
  source                     = "../../modules/autoscaling"
  environment                = var.environment
  worker_resource_id         = module.ecs.worker_service_resource_id
  min_capacity               = 2
  max_capacity               = 10
  target_messages_per_worker = 50
  scale_out_cooldown         = 30
  scale_in_cooldown          = 180
}
