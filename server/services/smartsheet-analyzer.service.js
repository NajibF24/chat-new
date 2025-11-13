class SmartsheetAnalyzer {
  constructor(sheetData) {
    this.data = sheetData;
    this.projects = sheetData.projects;
    this.columns = sheetData.columns;
    this.metadata = sheetData.metadata;
    this.today = new Date();
  }

  /**
   * Generate comprehensive insights from sheet data
   */
  generateInsights() {
    const insights = {
      overview: this.getOverview(),
      projectsByStatus: this.analyzeProjectsByStatus(),
      overdueProjects: this.findOverdueProjects(),
      recentUpdates: this.findRecentUpdates(),
      projectsWithIssues: this.findProjectsWithIssues(),
      riskAnalysis: this.analyzeRisks(),
      recommendations: this.generateRecommendations()
    };

    return insights;
  }

  /**
   * Get overview statistics
   */
  getOverview() {
    return {
      totalProjects: this.projects.length,
      lastUpdate: this.metadata.modifiedAt,
      dataFreshness: this.calculateDataFreshness(),
      completionRate: this.data.statistics.completionRate,
      columnsCount: this.columns.length
    };
  }

  /**
   * Analyze projects by status
   */
  analyzeProjectsByStatus() {
    const statusColumn = this.findStatusColumn();
    if (!statusColumn) return null;

    const byStatus = {};
    
    this.projects.forEach(project => {
      const status = project.data[statusColumn.title]?.value || 'Unknown';
      if (!byStatus[status]) {
        byStatus[status] = [];
      }
      byStatus[status].push({
        rowNumber: project.rowNumber,
        name: this.getProjectName(project)
      });
    });

    return byStatus;
  }

  /**
   * Find overdue projects
   */
  findOverdueProjects() {
    const dateColumns = this.columns.filter(col => 
      col.type === 'DATE' || 
      col.title.toLowerCase().includes('due') ||
      col.title.toLowerCase().includes('deadline') ||
      col.title.toLowerCase().includes('target')
    );

    if (dateColumns.length === 0) return [];

    const overdueProjects = [];

    this.projects.forEach(project => {
      dateColumns.forEach(dateCol => {
        const dateValue = project.data[dateCol.title]?.value;
        if (dateValue) {
          const dueDate = new Date(dateValue);
          if (dueDate < this.today && !this.isProjectCompleted(project)) {
            const daysOverdue = Math.floor((this.today - dueDate) / (1000 * 60 * 60 * 24));
            overdueProjects.push({
              name: this.getProjectName(project),
              rowNumber: project.rowNumber,
              dueDate: dateValue,
              daysOverdue: daysOverdue,
              status: this.getProjectStatus(project)
            });
          }
        }
      });
    });

    // Sort by days overdue (descending)
    return overdueProjects.sort((a, b) => b.daysOverdue - a.daysOverdue);
  }

  /**
   * Find recently updated projects
   */
  findRecentUpdates() {
    // Look for modified date column
    const modifiedColumn = this.columns.find(col => 
      col.title.toLowerCase().includes('modified') ||
      col.title.toLowerCase().includes('updated') ||
      col.title.toLowerCase().includes('last update')
    );

    if (!modifiedColumn) return [];

    const recentProjects = [];
    const sevenDaysAgo = new Date(this.today.getTime() - 7 * 24 * 60 * 60 * 1000);

    this.projects.forEach(project => {
      const modifiedValue = project.data[modifiedColumn.title]?.value;
      if (modifiedValue) {
        const modifiedDate = new Date(modifiedValue);
        if (modifiedDate >= sevenDaysAgo) {
          recentProjects.push({
            name: this.getProjectName(project),
            rowNumber: project.rowNumber,
            modifiedDate: modifiedValue,
            status: this.getProjectStatus(project)
          });
        }
      }
    });

    // Sort by modified date (descending)
    return recentProjects.sort((a, b) => 
      new Date(b.modifiedDate) - new Date(a.modifiedDate)
    );
  }

  /**
   * Find projects with issues
   */
  findProjectsWithIssues() {
    const issuesColumn = this.columns.find(col => 
      col.title.toLowerCase().includes('issue') ||
      col.title.toLowerCase().includes('problem') ||
      col.title.toLowerCase().includes('risk') ||
      col.title.toLowerCase().includes('concern')
    );

    if (!issuesColumn) return [];

    const projectsWithIssues = [];
    const noIssueValues = ['no issue', 'none', '-', 'n/a', 'no issues', '', 'tidak ada'];

    this.projects.forEach(project => {
      const issueValue = project.data[issuesColumn.title]?.value;
      if (issueValue) {
        const normalizedValue = String(issueValue).toLowerCase().trim();
        if (!noIssueValues.includes(normalizedValue)) {
          projectsWithIssues.push({
            name: this.getProjectName(project),
            rowNumber: project.rowNumber,
            issue: issueValue,
            status: this.getProjectStatus(project)
          });
        }
      }
    });

    return projectsWithIssues;
  }

  /**
   * Analyze risks
   */
  analyzeRisks() {
    const risks = {
      high: [],
      medium: [],
      low: []
    };

    // Analyze based on multiple factors
    this.projects.forEach(project => {
      const riskLevel = this.assessProjectRisk(project);
      if (riskLevel !== 'none') {
        risks[riskLevel].push({
          name: this.getProjectName(project),
          rowNumber: project.rowNumber,
          reasons: this.getRiskReasons(project)
        });
      }
    });

    return risks;
  }

  /**
   * Assess project risk level
   */
  assessProjectRisk(project) {
    let riskScore = 0;
    const reasons = [];

    // Check if overdue
    const dateColumns = this.columns.filter(col => 
      col.type === 'DATE' || col.title.toLowerCase().includes('due')
    );

    dateColumns.forEach(dateCol => {
      const dateValue = project.data[dateCol.title]?.value;
      if (dateValue) {
        const dueDate = new Date(dateValue);
        if (dueDate < this.today && !this.isProjectCompleted(project)) {
          const daysOverdue = Math.floor((this.today - dueDate) / (1000 * 60 * 60 * 24));
          if (daysOverdue > 30) {
            riskScore += 3;
          } else if (daysOverdue > 7) {
            riskScore += 2;
          } else {
            riskScore += 1;
          }
        }
      }
    });

    // Check for issues
    const issuesColumn = this.columns.find(col => 
      col.title.toLowerCase().includes('issue')
    );
    if (issuesColumn) {
      const issueValue = project.data[issuesColumn.title]?.value;
      if (issueValue && !['no issue', 'none', '-', 'n/a'].includes(String(issueValue).toLowerCase().trim())) {
        riskScore += 2;
      }
    }

    // Check status
    const status = this.getProjectStatus(project);
    if (status && status.toLowerCase().includes('blocked')) {
      riskScore += 2;
    } else if (status && status.toLowerCase().includes('at risk')) {
      riskScore += 1;
    }

    // Determine risk level
    if (riskScore >= 4) return 'high';
    if (riskScore >= 2) return 'medium';
    if (riskScore >= 1) return 'low';
    return 'none';
  }

  /**
   * Get reasons for project risk
   */
  getRiskReasons(project) {
    const reasons = [];

    // Check overdue
    const dateColumns = this.columns.filter(col => 
      col.type === 'DATE' || col.title.toLowerCase().includes('due')
    );

    dateColumns.forEach(dateCol => {
      const dateValue = project.data[dateCol.title]?.value;
      if (dateValue) {
        const dueDate = new Date(dateValue);
        if (dueDate < this.today && !this.isProjectCompleted(project)) {
          const daysOverdue = Math.floor((this.today - dueDate) / (1000 * 60 * 60 * 24));
          reasons.push(`Overdue by ${daysOverdue} days`);
        }
      }
    });

    // Check issues
    const issuesColumn = this.columns.find(col => 
      col.title.toLowerCase().includes('issue')
    );
    if (issuesColumn) {
      const issueValue = project.data[issuesColumn.title]?.value;
      if (issueValue && !['no issue', 'none', '-'].includes(String(issueValue).toLowerCase().trim())) {
        reasons.push(`Has active issue: ${issueValue}`);
      }
    }

    return reasons;
  }

  /**
   * Generate recommendations
   */
  generateRecommendations() {
    const recommendations = [];

    // Overdue projects recommendation
    const overdue = this.findOverdueProjects();
    if (overdue.length > 0) {
      recommendations.push({
        priority: 'high',
        category: 'Overdue Projects',
        message: `${overdue.length} project(s) are overdue. Immediate attention required.`,
        action: 'Review and update timelines or expedite completion'
      });
    }

    // Issues recommendation
    const withIssues = this.findProjectsWithIssues();
    if (withIssues.length > 0) {
      recommendations.push({
        priority: 'high',
        category: 'Projects with Issues',
        message: `${withIssues.length} project(s) have reported issues.`,
        action: 'Address issues and implement mitigation strategies'
      });
    }

    // Status distribution recommendation
    const byStatus = this.analyzeProjectsByStatus();
    if (byStatus) {
      const inProgress = Object.keys(byStatus).filter(status => 
        status.toLowerCase().includes('progress') || 
        status.toLowerCase().includes('ongoing')
      );
      if (inProgress.length > 0) {
        const total = inProgress.reduce((sum, status) => sum + byStatus[status].length, 0);
        if (total > this.projects.length * 0.7) {
          recommendations.push({
            priority: 'medium',
            category: 'Project Velocity',
            message: `${total} projects (${Math.round(total/this.projects.length*100)}%) are in progress. Consider resource allocation.`,
            action: 'Review resource distribution and prioritization'
          });
        }
      }
    }

    return recommendations;
  }

  /**
   * Format insights for AI context
   */
  formatInsightsForAI(insights) {
    let text = `# 🔍 AI-GENERATED INSIGHTS\n\n`;

    // Overview
    text += `## 📊 Overview\n`;
    text += `- Total Projects: ${insights.overview.totalProjects}\n`;
    text += `- Completion Rate: ${insights.overview.completionRate}\n`;
    text += `- Last Updated: ${new Date(insights.overview.lastUpdate).toLocaleString('id-ID')}\n`;
    text += `- Data Freshness: ${insights.overview.dataFreshness}\n\n`;

    // Overdue Projects
    if (insights.overdueProjects.length > 0) {
      text += `## ⚠️ OVERDUE PROJECTS (${insights.overdueProjects.length})\n`;
      insights.overdueProjects.slice(0, 5).forEach(project => {
        text += `- **${project.name}** (Row ${project.rowNumber})\n`;
        text += `  - Due Date: ${project.dueDate}\n`;
        text += `  - Overdue: ${project.daysOverdue} days\n`;
        text += `  - Status: ${project.status}\n`;
      });
      if (insights.overdueProjects.length > 5) {
        text += `  ... and ${insights.overdueProjects.length - 5} more\n`;
      }
      text += `\n`;
    }

    // Projects with Issues
    if (insights.projectsWithIssues.length > 0) {
      text += `## ⚠️ PROJECTS WITH ISSUES (${insights.projectsWithIssues.length})\n`;
      insights.projectsWithIssues.slice(0, 5).forEach(project => {
        text += `- **${project.name}** (Row ${project.rowNumber})\n`;
        text += `  - Issue: ${project.issue}\n`;
        text += `  - Status: ${project.status}\n`;
      });
      if (insights.projectsWithIssues.length > 5) {
        text += `  ... and ${insights.projectsWithIssues.length - 5} more\n`;
      }
      text += `\n`;
    }

    // Recent Updates
    if (insights.recentUpdates.length > 0) {
      text += `## 🔄 RECENT UPDATES (Last 7 Days)\n`;
      insights.recentUpdates.slice(0, 5).forEach(project => {
        text += `- **${project.name}** (Row ${project.rowNumber})\n`;
        text += `  - Updated: ${new Date(project.modifiedDate).toLocaleDateString('id-ID')}\n`;
        text += `  - Status: ${project.status}\n`;
      });
      text += `\n`;
    }

    // Risk Analysis
    if (insights.riskAnalysis) {
      const totalRisks = insights.riskAnalysis.high.length + 
                        insights.riskAnalysis.medium.length + 
                        insights.riskAnalysis.low.length;
      
      if (totalRisks > 0) {
        text += `## 🚨 RISK ANALYSIS\n`;
        
        if (insights.riskAnalysis.high.length > 0) {
          text += `\n### High Risk (${insights.riskAnalysis.high.length})\n`;
          insights.riskAnalysis.high.slice(0, 3).forEach(project => {
            text += `- **${project.name}** (Row ${project.rowNumber})\n`;
            project.reasons.forEach(reason => {
              text += `  - ${reason}\n`;
            });
          });
        }
        
        if (insights.riskAnalysis.medium.length > 0) {
          text += `\n### Medium Risk (${insights.riskAnalysis.medium.length})\n`;
          insights.riskAnalysis.medium.slice(0, 3).forEach(project => {
            text += `- **${project.name}** (Row ${project.rowNumber})\n`;
          });
        }
        
        text += `\n`;
      }
    }

    // Recommendations
    if (insights.recommendations.length > 0) {
      text += `## 💡 RECOMMENDATIONS\n`;
      insights.recommendations.forEach((rec, idx) => {
        text += `\n${idx + 1}. **${rec.category}** [${rec.priority.toUpperCase()}]\n`;
        text += `   - ${rec.message}\n`;
        text += `   - Action: ${rec.action}\n`;
      });
      text += `\n`;
    }

    return text;
  }

  // Helper methods

  findStatusColumn() {
    return this.columns.find(col => 
      col.title.toLowerCase().includes('status') ||
      col.title.toLowerCase().includes('progress') ||
      col.title.toLowerCase().includes('state')
    );
  }

  getProjectName(project) {
    // Try to find project name column
    const nameColumns = ['project name', 'name', 'title', 'project', 'task name'];
    
    for (const colName of nameColumns) {
      const column = this.columns.find(col => 
        col.title.toLowerCase().includes(colName)
      );
      if (column && project.data[column.title]?.value) {
        return project.data[column.title].value;
      }
    }

    // Fallback: return first non-empty value
    for (const [key, value] of Object.entries(project.data)) {
      if (value.value) {
        return String(value.value).substring(0, 50);
      }
    }

    return `Row ${project.rowNumber}`;
  }

  getProjectStatus(project) {
    const statusColumn = this.findStatusColumn();
    if (statusColumn && project.data[statusColumn.title]?.value) {
      return project.data[statusColumn.title].value;
    }
    return 'Unknown';
  }

  isProjectCompleted(project) {
    const status = this.getProjectStatus(project);
    const completedKeywords = ['complete', 'done', 'finish', 'selesai', 'closed'];
    return completedKeywords.some(keyword => 
      status.toLowerCase().includes(keyword)
    );
  }

  calculateDataFreshness() {
    const lastUpdate = new Date(this.metadata.modifiedAt);
    const diffMs = this.today - lastUpdate;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 60) return `${diffMins} minutes ago`;
    if (diffHours < 24) return `${diffHours} hours ago`;
    return `${diffDays} days ago`;
  }
}

export default SmartsheetAnalyzer;
